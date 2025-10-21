import { ethers } from 'ethers';

// Extend Window interface for ethereum
declare global {
  interface Window {
    ethereum?: any;
  }
}

// Yellow Network configuration
export const YELLOW_CONFIG = {
  // Testnet Clearnode WebSocket URL
  CLEARNODE_WS_URL: 'wss://clearnet-sandbox.yellow.com/ws',
  // Faucet URL for getting test tokens
  FAUCET_URL: 'https://clearnet-sandbox.yellow.com/faucet/requestTokens',
  // Supported chains for flash trading
  SUPPORTED_CHAINS: {
    SEPOLIA: '0xaa36a7', // 11155111
    BASE_SEPOLIA: '0x14a33', // 84532
    ARBITRUM_SEPOLIA: '0x66eee', // 421614
  },
  // Test token symbol
  TEST_TOKEN_SYMBOL: 'YELLOW_TEST_USD',
};

export interface FlashTradeParams {
  fromAsset: string;
  toAsset: string;
  amount: number;
  price: number;
  direction: 'up' | 'down';
  expiryTime: number;
}

export interface TradeResult {
  success: boolean;
  transactionId?: string;
  error?: string;
  balance?: {
    unified: number;
    available: number;
  };
}

export class YellowSDKService {
  private provider: ethers.Provider | null = null;
  private signer: ethers.Signer | null = null;
  private userAddress: string | null = null;
  private isConnected = false;
  private unifiedBalance = 0;

  constructor() {
    this.initializeProvider();
  }

  private async initializeProvider() {
    try {
      // Initialize ethers provider for wallet connection
      if (typeof window !== 'undefined' && window.ethereum) {
        this.provider = new ethers.BrowserProvider(window.ethereum);
        this.signer = await this.provider.getSigner();
        this.userAddress = await this.signer.getAddress();
      }
    } catch (error) {
      console.error('Failed to initialize provider:', error);
    }
  }

  async connectWallet(): Promise<boolean> {
    try {
      if (typeof window === 'undefined' || !window.ethereum) {
        throw new Error('No wallet detected. Please install MetaMask or another Web3 wallet.');
      }

      // Request account access
      await window.ethereum.request({ method: 'eth_requestAccounts' });
      
      this.provider = new ethers.BrowserProvider(window.ethereum);
      this.signer = await this.provider.getSigner();
      this.userAddress = await this.signer.getAddress();

      return true;
    } catch (error) {
      console.error('Wallet connection failed:', error);
      return false;
    }
  }

  async connectToClearnode(): Promise<boolean> {
    try {
      if (!this.signer || !this.userAddress) {
        throw new Error('Wallet not connected. Please connect your wallet first.');
      }

      // For now, we'll simulate a successful connection
      // In a real implementation, you would initialize NitroliteRPC and NitroliteClient
      this.isConnected = true;
      console.log('Successfully connected to Yellow Network Clearnode (simulated)');
      
      // Initialize with some test balance
      this.unifiedBalance = 100; // Simulated balance
      
      return true;
    } catch (error) {
      console.error('Failed to connect to Clearnode:', error);
      this.isConnected = false;
      return false;
    }
  }

  async getUnifiedBalance(): Promise<number> {
    try {
      if (!this.isConnected) {
        throw new Error('Not connected to Yellow Network');
      }

      // For now, return simulated balance
      // In a real implementation, you would call the actual Yellow Network API
      return this.unifiedBalance;
    } catch (error) {
      console.error('Failed to get unified balance:', error);
      return 0;
    }
  }

  async requestTestTokens(amount: number = 10): Promise<boolean> {
    try {
      if (!this.userAddress) {
        throw new Error('User address not available');
      }

      const response = await fetch(YELLOW_CONFIG.FAUCET_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userAddress: this.userAddress,
        }),
      });

      if (!response.ok) {
        throw new Error(`Faucet request failed: ${response.statusText}`);
      }

      const result = await response.json();
      console.log('Test tokens requested:', result);
      
      // Simulate balance increase
      this.unifiedBalance += amount;
      
      return true;
    } catch (error) {
      console.error('Failed to request test tokens:', error);
      return false;
    }
  }

  async executeFlashTrade(params: FlashTradeParams): Promise<TradeResult> {
    try {
      if (!this.isConnected) {
        throw new Error('Not connected to Yellow Network');
      }

      const { fromAsset, toAsset, amount, price, direction, expiryTime } = params;

      // Check if we have sufficient balance
      if (this.unifiedBalance < amount) {
        return {
          success: false,
          error: `Insufficient balance. Required: ${amount}, Available: ${this.unifiedBalance}`,
          balance: { unified: this.unifiedBalance, available: this.unifiedBalance },
        };
      }

      // Simulate trade execution
      // In a real implementation, you would interact with your prediction market contract
      const tradeData = {
        fromAsset,
        toAsset,
        amount,
        price,
        direction,
        expiryTime,
        timestamp: Date.now(),
      };

      // Simulate transaction
      const txResult = {
        hash: `0x${Math.random().toString(16).substr(2, 40)}`, // Simulated transaction hash
        success: true,
      };

      // Update balance (simulate trade cost)
      this.unifiedBalance -= amount;

      return {
        success: true,
        transactionId: txResult.hash,
        balance: { unified: this.unifiedBalance, available: this.unifiedBalance },
      };
    } catch (error) {
      console.error('Flash trade execution failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  async getTradeHistory(): Promise<any[]> {
    try {
      if (!this.isConnected) {
        throw new Error('Not connected to Yellow Network');
      }

      // Return empty array for now
      // In a real implementation, you would fetch from your contract or Yellow Network
      return [];
    } catch (error) {
      console.error('Failed to get trade history:', error);
      return [];
    }
  }

  async withdrawProfit(amount: number): Promise<TradeResult> {
    try {
      if (!this.isConnected) {
        throw new Error('Not connected to Yellow Network');
      }

      if (amount <= 0) {
        return {
          success: false,
          error: 'Invalid withdrawal amount',
        };
      }

      if (this.unifiedBalance < amount) {
        return {
          success: false,
          error: `Insufficient balance. Available: ${this.unifiedBalance}`,
        };
      }

      // Simulate withdrawal process
      // In a real implementation, you would:
      // 1. Create a withdrawal transaction through Yellow Network
      // 2. Specify which chain to withdraw to
      // 3. Handle the actual on-chain withdrawal

      const withdrawalData = {
        amount,
        timestamp: Date.now(),
        userAddress: this.userAddress,
      };

      // Simulate successful withdrawal
      this.unifiedBalance -= amount;

      return {
        success: true,
        transactionId: `withdrawal_${Date.now()}`,
        balance: { unified: this.unifiedBalance, available: this.unifiedBalance },
      };
    } catch (error) {
      console.error('Withdrawal failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  async settleSession(): Promise<TradeResult> {
    try {
      if (!this.isConnected) {
        throw new Error('Not connected to Yellow Network');
      }

      // In a real implementation, this would:
      // 1. Settle all pending bets
      // 2. Calculate final profits
      // 3. Withdraw to user's preferred chain
      // 4. Close the Yellow Network session

      const finalBalance = this.unifiedBalance;
      
      return {
        success: true,
        transactionId: `settlement_${Date.now()}`,
        balance: { unified: finalBalance, available: finalBalance },
      };
    } catch (error) {
      console.error('Session settlement failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  async disconnect(): Promise<void> {
    try {
      this.isConnected = false;
      this.provider = null;
      this.signer = null;
      this.userAddress = null;
      this.unifiedBalance = 0;
      console.log('Disconnected from Yellow Network');
    } catch (error) {
      console.error('Error during disconnect:', error);
    }
  }

  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  getUserAddress(): string | null {
    return this.userAddress;
  }
}

// Global instance
export const yellowSDK = new YellowSDKService();

// Helper function to format balance
export function formatBalance(balance: number): string {
  return balance.toFixed(2);
}

// Helper function to calculate trade outcome
export function calculateTradeOutcome(
  entryPrice: number,
  currentPrice: number,
  direction: 'up' | 'down',
  amount: number
): { profit: number; percentage: number; won: boolean } {
  const priceChange = currentPrice - entryPrice;
  const priceChangePercent = (priceChange / entryPrice) * 100;
  
  let won = false;
  if (direction === 'up' && priceChange > 0) {
    won = true;
  } else if (direction === 'down' && priceChange < 0) {
    won = true;
  }

  const profit = won ? amount * 1.95 : -amount; // Assuming 95% payout rate
  const percentage = won ? 95 : -100;

  return { profit, percentage, won };
}
