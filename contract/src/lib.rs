#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    Address, Env, Symbol, token,
};

// ─── Storage keys ────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Order(u64),    // keyed by order_id
    OrderCount,    // auto-increment counter
    Admin,         // contract admin for dispute resolution
}

// ─── Order state machine ──────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub enum OrderStatus {
    Open,       // created, waiting for agent
    Accepted,   // agent accepted, awaiting shipment
    Shipped,    // agent marked as shipped
    Completed,  // buyer confirmed delivery, funds released
    Disputed,   // buyer raised a dispute, funds frozen
    Resolved,   // admin resolved dispute
    Cancelled,  // order cancelled before acceptance
}

#[contracttype]
#[derive(Clone)]
pub struct Order {
    pub id: u64,
    pub buyer: Address,
    pub agent: Option<Address>,
    pub usdc_token: Address,    // USDC contract address on Stellar testnet
    pub amount: i128,           // total USDC locked (item cost + service fee)
    pub service_fee: i128,      // fee going to agent on completion
    pub status: OrderStatus,
    pub item_description: Symbol, // short product description (≤9 chars for Symbol)
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct PasaBuyContract;

#[contractimpl]
impl PasaBuyContract {

    /// Initialize the contract with an admin address.
    /// Admin is used only for dispute resolution.
    pub fn initialize(env: Env, admin: Address) {
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::OrderCount, &0u64);
    }

    /// Buyer creates a new order by locking USDC into the contract.
    /// `amount` = full USDC to lock (item + service fee combined).
    /// `service_fee` = portion released to agent on confirm_delivery.
    /// Returns the new order ID.
    pub fn create_order(
        env: Env,
        buyer: Address,
        usdc_token: Address,
        amount: i128,
        service_fee: i128,
        item_description: Symbol,
    ) -> u64 {
        // Buyer must authorize this call
        buyer.require_auth();

        // Service fee must be less than total amount
        if service_fee >= amount || amount <= 0 {
            panic!("invalid amount or service fee");
        }

        // Transfer USDC from buyer into this contract (escrow lock)
        let token_client = token::Client::new(&env, &usdc_token);
        token_client.transfer(&buyer, &env.current_contract_address(), &amount);

        // Increment order counter
        let count: u64 = env.storage().instance().get(&DataKey::OrderCount).unwrap_or(0);
        let order_id = count + 1;
        env.storage().instance().set(&DataKey::OrderCount, &order_id);

        // Save order to storage
        let order = Order {
            id: order_id,
            buyer: buyer.clone(),
            agent: None,
            usdc_token,
            amount,
            service_fee,
            status: OrderStatus::Open,
            item_description,
        };
        env.storage().instance().set(&DataKey::Order(order_id), &order);

        // Emit event for indexers / frontend
        env.events().publish(
            (symbol_short!("created"), buyer),
            order_id,
        );

        order_id
    }

    /// Agent accepts an open order, committing to fulfill it.
    pub fn accept_order(env: Env, agent: Address, order_id: u64) {
        agent.require_auth();

        let mut order: Order = env
            .storage().instance()
            .get(&DataKey::Order(order_id))
            .expect("order not found");

        if order.status != OrderStatus::Open {
            panic!("order is not open");
        }

        order.agent = Some(agent.clone());
        order.status = OrderStatus::Accepted;
        env.storage().instance().set(&DataKey::Order(order_id), &order);

        env.events().publish(
            (symbol_short!("accepted"), agent),
            order_id,
        );
    }

    /// Agent marks the item as shipped.
    pub fn mark_shipped(env: Env, agent: Address, order_id: u64) {
        agent.require_auth();

        let mut order: Order = env
            .storage().instance()
            .get(&DataKey::Order(order_id))
            .expect("order not found");

        if order.status != OrderStatus::Accepted {
            panic!("order not in accepted state");
        }
        if order.agent.as_ref() != Some(&agent) {
            panic!("caller is not the assigned agent");
        }

        order.status = OrderStatus::Shipped;
        env.storage().instance().set(&DataKey::Order(order_id), &order);
    }

    /// Buyer confirms delivery. Releases USDC to the agent.
    /// This is the core MVP transaction that proves escrow works end-to-end.
    pub fn confirm_delivery(env: Env, buyer: Address, order_id: u64) {
        buyer.require_auth();

        let mut order: Order = env
            .storage().instance()
            .get(&DataKey::Order(order_id))
            .expect("order not found");

        if order.status != OrderStatus::Shipped {
            panic!("item has not been marked shipped");
        }
        if order.buyer != buyer {
            panic!("caller is not the order buyer");
        }

        let agent = order.agent.clone().expect("no agent assigned");

        // Release full locked amount to agent
        let token_client = token::Client::new(&env, &order.usdc_token);
        token_client.transfer(&env.current_contract_address(), &agent, &order.amount);

        order.status = OrderStatus::Completed;
        env.storage().instance().set(&DataKey::Order(order_id), &order);

        env.events().publish(
            (symbol_short!("complete"), buyer),
            order_id,
        );
    }

    /// Buyer raises a dispute — freezes funds in the contract.
    pub fn dispute(env: Env, buyer: Address, order_id: u64) {
        buyer.require_auth();

        let mut order: Order = env
            .storage().instance()
            .get(&DataKey::Order(order_id))
            .expect("order not found");

        // Can dispute once shipped (or even accepted, agent hasn't shipped yet)
        if order.status != OrderStatus::Shipped && order.status != OrderStatus::Accepted {
            panic!("cannot dispute in current state");
        }
        if order.buyer != buyer {
            panic!("caller is not the order buyer");
        }

        order.status = OrderStatus::Disputed;
        env.storage().instance().set(&DataKey::Order(order_id), &order);

        env.events().publish(
            (symbol_short!("disputed"), buyer),
            order_id,
        );
    }

    /// Admin resolves a dispute by sending funds to either buyer (refund) or agent (pay).
    /// `refund_buyer`: true = refund buyer; false = pay agent.
    pub fn resolve_dispute(
        env: Env,
        admin: Address,
        order_id: u64,
        refund_buyer: bool,
    ) {
        admin.require_auth();

        let stored_admin: Address = env
            .storage().instance()
            .get(&DataKey::Admin)
            .expect("admin not set");
        if stored_admin != admin {
            panic!("caller is not admin");
        }

        let mut order: Order = env
            .storage().instance()
            .get(&DataKey::Order(order_id))
            .expect("order not found");

        if order.status != OrderStatus::Disputed {
            panic!("order is not in disputed state");
        }

        let token_client = token::Client::new(&env, &order.usdc_token);

        if refund_buyer {
            // Return locked funds to buyer
            token_client.transfer(
                &env.current_contract_address(),
                &order.buyer,
                &order.amount,
            );
        } else {
            // Pay agent
            let agent = order.agent.clone().expect("no agent assigned");
            token_client.transfer(
                &env.current_contract_address(),
                &agent,
                &order.amount,
            );
        }

        order.status = OrderStatus::Resolved;
        env.storage().instance().set(&DataKey::Order(order_id), &order);
    }

    /// Read an order by ID.
    pub fn get_order(env: Env, order_id: u64) -> Order {
        env.storage().instance()
            .get(&DataKey::Order(order_id))
            .expect("order not found")
    }

    /// Returns total number of orders created.
    pub fn order_count(env: Env) -> u64 {
        env.storage().instance()
            .get(&DataKey::OrderCount)
            .unwrap_or(0)
    }
}

#[cfg(test)]
mod test;
