import { NitroliteClient, NitroliteRPC } from '@erc7824/nitrolite';
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
  private nitroliteClient: NitroliteClient | null = null;
  private nitroliteRPC: NitroliteRPC | null = null;
  private provider: ethers.Provider | null = null;
  private signer: ethers.Signer | null = null;
  private userAddress: string | null = null;
  private isConnected = false;

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

      // Initialize Nitrolite RPC for high-level operations
      this.nitroliteRPC = new NitroliteRPC({
        clearnodeWsUrl: YELLOW_CONFIG.CLEARNODE_WS_URL,
        signer: this.signer,
      });

      // Initialize Nitrolite Client for low-level state channel control
      this.nitroliteClient = new NitroliteClient({
        clearnodeWsUrl: YELLOW_CONFIG.CLEARNODE_WS_URL,
        signer: this.signer,
      });

      // Connect to the Clearnode
      await this.nitroliteRPC.initialize();
      await this.nitroliteClient.initialize();

      this.isConnected = true;
      console.log('Successfully connected to Yellow Network Clearnode');
      return true;
    } catch (error) {
      console.error('Failed to connect to Clearnode:', error);
      this.isConnected = false;
      return false;
    }
  }

  async getUnifiedBalance(): Promise<number> {
    try {
      if (!this.nitroliteRPC || !this.isConnected) {
        throw new Error('Not connected to Yellow Network');
      }

      // Use the correct API method for getting balance
      const balance = await this.nitroliteRPC.getBalance();
      return parseFloat(balance.toString());
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
      return true;
    } catch (error) {
      console.error('Failed to request test tokens:', error);
      return false;
    }
  }

  async executeFlashTrade(params: FlashTradeParams): Promise<TradeResult> {
    try {
      if (!this.nitroliteRPC || !this.isConnected) {
        throw new Error('Not connected to Yellow Network');
      }

      const { fromAsset, toAsset, amount, price, direction, expiryTime } = params;

      // Check if we have sufficient balance
      const currentBalance = await this.getUnifiedBalance();
      if (currentBalance < amount) {
        return {
          success: false,
          error: `Insufficient balance. Required: ${amount}, Available: ${currentBalance}`,
          balance: { unified: currentBalance, available: currentBalance },
        };
      }

      // Create a flash trade transaction
      // This is a simplified implementation - in a real scenario, you'd need to:
      // 1. Create a prediction market contract interaction
      // 2. Set up the trade parameters with price prediction
      // 3. Execute the trade with expiry conditions

      const tradeData = {
        fromAsset,
        toAsset,
        amount: ethers.parseUnits(amount.toString(), 6), // Assuming 6 decimals for test tokens
        price: ethers.parseUnits(price.toString(), 8), // Assuming 8 decimals for price
        direction,
        expiryTime: BigInt(expiryTime),
        timestamp: BigInt(Date.now()),
      };

      // Execute the trade through Nitrolite RPC
      // For now, we'll simulate a successful transaction
      // In a real implementation, you would interact with your prediction market contract
      const txResult = {
        hash: `0x${Math.random().toString(16).substr(2, 40)}`, // Simulated transaction hash
        success: true,
      };

      // Get updated balance
      const newBalance = await this.getUnifiedBalance();

      return {
        success: true,
        transactionId: txResult.hash,
        balance: { unified: newBalance, available: newBalance },
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
      if (!this.nitroliteRPC || !this.isConnected) {
        throw new Error('Not connected to Yellow Network');
      }

      // This would typically fetch from your prediction market contract
      // For now, return empty array as placeholder
      return [];
    } catch (error) {
      console.error('Failed to get trade history:', error);
      return [];
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.nitroliteRPC) {
        // Use the correct disconnect method
        await this.nitroliteRPC.close();
      }
      if (this.nitroliteClient) {
        // Use the correct disconnect method
        await this.nitroliteClient.close();
      }
      this.isConnected = false;
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
