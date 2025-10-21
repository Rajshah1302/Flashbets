import { useState, useEffect, useCallback } from 'react';
import { useAccount, useConnect, useDisconnect, useBalance } from 'wagmi';
import { YellowSDKWagmiService, FlashTradeParams, TradeResult } from './yellow-sdk-wagmi';

export interface YellowSDKState {
  isConnected: boolean;
  isConnecting: boolean;
  userAddress: string | null;
  balance: number;
  isLoading: boolean;
  error: string | null;
}

export interface YellowSDKActions {
  connectWallet: () => Promise<boolean>;
  connectToClearnode: () => Promise<boolean>;
  disconnect: () => Promise<void>;
  requestTestTokens: (amount?: number) => Promise<boolean>;
  executeFlashTrade: (params: FlashTradeParams) => Promise<TradeResult>;
  withdrawProfit: (amount: number) => Promise<TradeResult>;
  settleSession: () => Promise<TradeResult>;
  refreshBalance: () => Promise<void>;
  clearError: () => void;
}

export function useYellowSDKWagmi(): YellowSDKState & YellowSDKActions {
  // Wagmi hooks
  const { address, isConnected: wagmiConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect: wagmiDisconnect } = useDisconnect();
  const { data: balanceData } = useBalance({
    address: address,
  });

  const [state, setState] = useState<YellowSDKState>({
    isConnected: false,
    isConnecting: false,
    userAddress: null,
    balance: 0,
    isLoading: false,
    error: null,
  });

  // Initialize Yellow SDK service
  const [yellowSDK] = useState(() => new YellowSDKWagmiService());

  // Initialize wagmi hooks in Yellow SDK
  useEffect(() => {
    yellowSDK.initializeWagmiHooks({
      account: { address },
      connect,
      disconnect: wagmiDisconnect,
      balance: balanceData,
      writeContract: null, // We'll add this later if needed
    });
  }, [address, connect, wagmiDisconnect, balanceData, yellowSDK]);

  // Update connection status when wagmi connection changes
  useEffect(() => {
    setState(prev => ({
      ...prev,
      userAddress: address || null,
      isConnected: prev.isConnected && wagmiConnected,
    }));
  }, [address, wagmiConnected]);

  const connectWallet = useCallback(async (): Promise<boolean> => {
    setState(prev => ({ ...prev, isConnecting: true, error: null }));
    
    try {
      // Use wagmi to connect to the first available connector (MetaMask)
      const connector = connectors[0]; // MetaMask
      await connect({ connector });
      
      setState(prev => ({
        ...prev,
        isConnecting: false,
        userAddress: address || null,
        error: null,
      }));
      
      return true;
    } catch (error) {
      setState(prev => ({
        ...prev,
        isConnecting: false,
        error: error instanceof Error ? error.message : 'Failed to connect wallet',
      }));
      return false;
    }
  }, [connect, connectors, address]);

  const connectToClearnode = useCallback(async (): Promise<boolean> => {
    setState(prev => ({ ...prev, isConnecting: true, error: null }));
    
    try {
      const success = await yellowSDK.connectToClearnode();
      
      setState(prev => ({
        ...prev,
        isConnecting: false,
        isConnected: success,
        error: success ? null : 'Failed to connect to Yellow Network',
      }));
      
      // If successfully connected, fetch balance
      if (success) {
        await refreshBalance();
      }
      
      return success;
    } catch (error) {
      setState(prev => ({
        ...prev,
        isConnecting: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      }));
      return false;
    }
  }, [yellowSDK]);

  const disconnect = useCallback(async (): Promise<void> => {
    setState(prev => ({ ...prev, isConnecting: true }));
    
    try {
      await yellowSDK.disconnect();
      
      setState(prev => ({
        ...prev,
        isConnecting: false,
        isConnected: false,
        userAddress: null,
        balance: 0,
        error: null,
      }));
    } catch (error) {
      setState(prev => ({
        ...prev,
        isConnecting: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      }));
    }
  }, [yellowSDK]);

  const requestTestTokens = useCallback(async (amount: number = 10): Promise<boolean> => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    
    try {
      const success = await yellowSDK.requestTestTokens(amount);
      
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: success ? null : 'Failed to request test tokens',
      }));
      
      // Refresh balance after requesting tokens
      if (success) {
        await refreshBalance();
      }
      
      return success;
    } catch (error) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      }));
      return false;
    }
  }, [yellowSDK]);

  const executeFlashTrade = useCallback(async (params: FlashTradeParams): Promise<TradeResult> => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    
    try {
      const result = await yellowSDK.executeFlashTrade(params);
      
      setState(prev => ({
        ...prev,
        isLoading: false,
        balance: result.balance?.unified ?? prev.balance,
        error: result.success ? null : result.error ?? 'Trade execution failed',
      }));
      
      // Refresh balance after trade
      if (result.success) {
        await refreshBalance();
      }
      
      return result;
    } catch (error) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      }));
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }, [yellowSDK]);

  const withdrawProfit = useCallback(async (amount: number): Promise<TradeResult> => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    
    try {
      const result = await yellowSDK.withdrawProfit(amount);
      
      setState(prev => ({
        ...prev,
        isLoading: false,
        balance: result.balance?.unified ?? prev.balance,
        error: result.success ? null : result.error ?? 'Withdrawal failed',
      }));
      
      return result;
    } catch (error) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      }));
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }, [yellowSDK]);

  const settleSession = useCallback(async (): Promise<TradeResult> => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    
    try {
      const result = await yellowSDK.settleSession();
      
      setState(prev => ({
        ...prev,
        isLoading: false,
        balance: result.balance?.unified ?? prev.balance,
        error: result.success ? null : result.error ?? 'Session settlement failed',
      }));
      
      return result;
    } catch (error) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      }));
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }, [yellowSDK]);

  const refreshBalance = useCallback(async (): Promise<void> => {
    if (!yellowSDK.getConnectionStatus()) {
      return;
    }
    
    setState(prev => ({ ...prev, isLoading: true }));
    
    try {
      const balance = await yellowSDK.getUnifiedBalance();
      
      setState(prev => ({
        ...prev,
        isLoading: false,
        balance,
      }));
    } catch (error) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to fetch balance',
      }));
    }
  }, [yellowSDK]);

  const clearError = useCallback((): void => {
    setState(prev => ({ ...prev, error: null }));
  }, []);

  return {
    ...state,
    connectWallet,
    connectToClearnode,
    disconnect,
    requestTestTokens,
    executeFlashTrade,
    withdrawProfit,
    settleSession,
    refreshBalance,
    clearError,
  };
}
