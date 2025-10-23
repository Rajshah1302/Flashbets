/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useCallback, useState } from "react";
import { createWalletClient, custom, type Address, type WalletClient } from "viem";
import { mainnet } from "viem/chains";

declare global {
  interface Window {
    ethereum?: any;
  }
}

export default function useWalletViem() {
  const [account, setAccount] = useState<Address | null>(null);
  const [walletClient, setWalletClient] = useState<WalletClient | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connectWallet = useCallback(async () => {
    try {
      setError(null);
      if (!window?.ethereum) {
        setError("No wallet detected. Please install MetaMask or a compatible wallet.");
        return false;
      }
      setIsConnecting(true);

      const client = createWalletClient({
        chain: mainnet,              
        transport: custom(window.ethereum),
      });

      const [address] = await client.requestAddresses();
      setWalletClient(client);
      setAccount(address);
      return true;
    } catch (e: any) {
      setError(e?.message ?? "Failed to connect wallet");
      return false;
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setAccount(null);
    setWalletClient(null);
  }, []);

  return { account, walletClient, isConnecting, error, connectWallet, disconnect, setError };
}
