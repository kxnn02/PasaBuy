#[cfg(test)]
mod tests {
    use soroban_sdk::{
        testutils::Address as _,
        token, Address, Env, symbol_short,
    };
    use crate::{PasaBuyContract, PasaBuyContractClient, OrderStatus};

    fn setup() -> (Env, Address, Address, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let agent = Address::generate(&env);

        // Register a Stellar Asset Contract (acts as our native XLM mock)
        let sac = env.register_stellar_asset_contract_v2(admin.clone());
        let token_address = sac.address();

        let contract_id = env.register(PasaBuyContract, ());
        let client = PasaBuyContractClient::new(&env, &contract_id);

        // Initialize with admin AND the token contract address
        client.initialize(&admin, &token_address);

        // Mint tokens to the buyer so they can lock funds
        let sac_client = token::StellarAssetClient::new(&env, &token_address);
        sac_client.mint(&buyer, &1000_0000000i128);

        (env, contract_id, token_address, admin, buyer, agent)
    }

    // ─── Test 1: Happy path ──────────────────────────────────────────────────
    // Full end-to-end: create → accept → ship → confirm
    // Verifies buyer's XLM is locked, then released to agent on confirm.

    #[test]
    fn test_full_order_lifecycle() {
        let (env, contract_id, token_address, _admin, buyer, agent) = setup();
        let client = PasaBuyContractClient::new(&env, &contract_id);
        let xlm_token = token::Client::new(&env, &token_address);

        let amount: i128 = 100_0000000;
        let service_fee: i128 = 10_0000000;

        let order_id = client.create_order(
            &buyer,
            &amount,
            &service_fee,
            &symbol_short!("NikeAJ1"),
        );

        assert_eq!(xlm_token.balance(&buyer), 900_0000000);

        client.accept_order(&agent, &order_id);
        client.mark_shipped(&agent, &order_id);

        let agent_balance_before = xlm_token.balance(&agent);
        client.confirm_delivery(&buyer, &order_id);
        let agent_balance_after = xlm_token.balance(&agent);

        assert_eq!(agent_balance_after - agent_balance_before, amount);

        let order = client.get_order(&order_id);
        assert_eq!(order.status, OrderStatus::Completed);
    }

    // ─── Test 2: Edge case ───────────────────────────────────────────────────
    // Duplicate acceptance: a second agent cannot accept an already-accepted order.

    #[test]
    #[should_panic(expected = "order is not open")]
    fn test_cannot_accept_already_accepted_order() {
        let (env, contract_id, _token_address, _admin, buyer, agent) = setup();
        let client = PasaBuyContractClient::new(&env, &contract_id);

        let order_id = client.create_order(
            &buyer,
            &100_0000000,
            &10_0000000,
            &symbol_short!("item"),
        );

        client.accept_order(&agent, &order_id);

        let second_agent = Address::generate(&env);
        client.accept_order(&second_agent, &order_id);
    }

    // ─── Test 3: State verification ──────────────────────────────────────────
    // After create_order(), storage must correctly record buyer, amount, and status=Open.

    #[test]
    fn test_storage_state_after_create_order() {
        let (env, contract_id, _token_address, _admin, buyer, _agent) = setup();
        let client = PasaBuyContractClient::new(&env, &contract_id);

        let amount: i128 = 50_0000000;
        let service_fee: i128 = 5_0000000;

        let order_id = client.create_order(
            &buyer,
            &amount,
            &service_fee,
            &symbol_short!("YesStyle"),
        );

        let order = client.get_order(&order_id);

        assert_eq!(order.buyer, buyer);
        assert_eq!(order.amount, amount);
        assert!(order.agent.is_none());
        assert_eq!(order.status, OrderStatus::Open);
        assert_eq!(client.order_count(), 1);
    }

    // ─── Test 4: Dispute flow ────────────────────────────────────────────────
    // Buyer raises a dispute after item is marked shipped.
    // Funds must remain frozen in contract (not released to agent or buyer).

    #[test]
    fn test_buyer_can_dispute_after_shipment() {
        let (env, contract_id, token_address, _admin, buyer, agent) = setup();
        let client = PasaBuyContractClient::new(&env, &contract_id);
        let xlm_token = token::Client::new(&env, &token_address);

        let amount: i128 = 80_0000000;

        let order_id = client.create_order(
            &buyer,
            &amount,
            &8_0000000,
            &symbol_short!("AirMax"),
        );

        client.accept_order(&agent, &order_id);
        client.mark_shipped(&agent, &order_id);

        // Buyer raises dispute
        client.dispute(&buyer, &order_id);

        // Order status must be Disputed
        let order = client.get_order(&order_id);
        assert_eq!(order.status, OrderStatus::Disputed);

        // Funds must still be locked in contract — neither buyer nor agent received them
        assert_eq!(xlm_token.balance(&buyer), 920_0000000); // 1000 - 80
        assert_eq!(xlm_token.balance(&agent), 0);
    }

    // ─── Test 5: Admin resolves dispute with refund ──────────────────────────
    // Admin calls resolve_dispute(refund_buyer=true).
    // Buyer must receive full XLM back; agent receives nothing.

    #[test]
    fn test_admin_resolves_dispute_with_refund() {
        let (env, contract_id, token_address, admin, buyer, agent) = setup();
        let client = PasaBuyContractClient::new(&env, &contract_id);
        let xlm_token = token::Client::new(&env, &token_address);

        let amount: i128 = 60_0000000;

        let order_id = client.create_order(
            &buyer,
            &amount,
            &6_0000000,
            &symbol_short!("Gucci"),
        );

        client.accept_order(&agent, &order_id);
        client.mark_shipped(&agent, &order_id);
        client.dispute(&buyer, &order_id);

        let buyer_balance_before = xlm_token.balance(&buyer);

        // Admin decides in buyer's favor
        client.resolve_dispute(&admin, &order_id, &true);

        // Buyer must get full amount back
        assert_eq!(
            xlm_token.balance(&buyer) - buyer_balance_before,
            amount
        );

        // Agent gets nothing
        assert_eq!(xlm_token.balance(&agent), 0);

        // Order must be marked Resolved
        let order = client.get_order(&order_id);
        assert_eq!(order.status, OrderStatus::Resolved);
    }
}