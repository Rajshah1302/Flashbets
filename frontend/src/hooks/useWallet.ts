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

  const connectWallet = async () => {
    if (!window.ethereum) {
        alert('Please install MetaMask!');
        return;
    }

    // First get the address
    const tempClient = createWalletClient({
        chain: mainnet,
        transport: custom(window.ethereum),
    });
    const [address] = await tempClient.requestAddresses();

    // CHAPTER 3: Create wallet client with account for EIP-712 signing
    const walletClient = createWalletClient({
        account: address,
        chain: mainnet,
        transport: custom(window.ethereum),
    });

    setWalletClient(walletClient);
    setAccount(address);
};

  const disconnect = useCallback(() => {
    setAccount(null);
    setWalletClient(null);
  }, []);

  return { account, walletClient, isConnecting, error, connectWallet, disconnect, setError };
}
