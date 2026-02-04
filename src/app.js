import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import Environment from './config/env.js';
import connectDB from './config/db.js'; 
import { notFound, errorHandler } from './middleware/errorHandler.js';
import os from 'os';

// Route Imports
import authRoutes from './routes/authRoutes.js';
import depotRoutes from './routes/depotRoutes.js'; 
import walletRoutes from './routes/walletRoutes.js';
import farmerRoutes from './routes/farmerRoutes.js';  
import adminRoutes from './routes/adminRoutes.js';   
import kccRoutes from './routes/kccRoutes.js';
import withdrawalRoutes from './routes/withdrawalRoutes.js';
import mpesaRoutes from './routes/mpesaRoutes.js';

class App {
  constructor() {
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  /**
   * Configure application middleware
   */
  setupMiddleware() {
    // Security & CORS - Allow all origins for testing
    this.app.use(cors({
      origin: '*', // Allow all origins
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
    }));

    // Request logging
    if (Environment.isDevelopment()) {
      this.app.use(morgan('dev'));
    } else {
      this.app.use(morgan('combined'));
    }

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));

    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({
        success: true,
        message: 'MilkBank API is running 🥛',
        timestamp: new Date().toISOString(),
        environment: Environment.get('NODE_ENV'),
        version: '1.0.0'
      });
    });

    // API Documentation endpoint
    this.app.get('/api', (req, res) => {
      res.json({
        success: true,
        message: 'MilkBank API Documentation',
        version: '1.0.0',
        endpoints: {
          authentication: '/api/auth',
          farmers: '/api/farmers',
          depots: '/api/depots',
          wallet: '/api/wallet',
          admin: '/api/admin',
          kcc: '/api/kcc',
          withdraw: '/api/withdraw',
          mpesa: '/api/mpesa'
        }
      });
    });
  }

  /**
   * Configure API routes - Grouped by user roles
   */
  setupRoutes() {
    // Authentication Routes
    this.app.use('/api/auth', authRoutes);
    
    // Farmer Routes
    this.app.use('/api/farmers', farmerRoutes);
    
    // Depot Routes
    this.app.use('/api/depots', depotRoutes);
    
    // Wallet & Token Routes
    this.app.use('/api/wallet', walletRoutes);
    
    // Admin Routes
    this.app.use('/api/admin', adminRoutes);

    // KCC Routes
    this.app.use('/api/kcc', kccRoutes);

    // Withdrawal Routes
    this.app.use('/api/withdraw', withdrawalRoutes);

    // M-Pesa Routes
    this.app.use('/api/mpesa', mpesaRoutes);
  }
 
  /**
   * Configure error handling
   */
  setupErrorHandling() {
    this.app.use(notFound);
    this.app.use(errorHandler);
  }

  /**
   * Get local IP address
   */
  getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        // Skip internal and non-IPv4 addresses
        if (iface.family === 'IPv4' && !iface.internal) {
          // Prefer WiFi/Ethernet over other interfaces
          if (name.toLowerCase().includes('wi-fi') || 
              name.toLowerCase().includes('ethernet') ||
              name.toLowerCase().includes('wlan')) {
            return iface.address;
          }
        }
      }
    }
    // Fallback to first found IP
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
    return 'localhost';
  }

  /**
   * Start the server
   */
  async start() {
    try {
      await connectDB();

      const PORT = Environment.get('PORT') || 5000;
      const HOST = '0.0.0.0'; // Listen on all network interfaces
      const localIP = this.getLocalIP();
      
      this.server = this.app.listen(PORT, HOST, () => {
        console.log(`
╔═══════════════════════════════════════════════════════╗
║        🥛 MilkBank API Server Started!               ║
╠═══════════════════════════════════════════════════════╣
║ 📍 Local:      http://localhost:${PORT.toString().padEnd(4)}              ║
║ 🌐 Network:    http://${localIP}:${PORT}            ║
║ 🔌 Listening:  ${HOST}:${PORT}                      ║
╠═══════════════════════════════════════════════════════╣
║ 📱 Environment: ${Environment.get('NODE_ENV') || 'development'}      ║
║ 🗄️ Database:   Connected ✅                         ║
║ ⏰ Started:    ${new Date().toLocaleTimeString()}             ║
╚═══════════════════════════════════════════════════════╝

💡 For Expo Go on same WiFi:
• Use: http://${localIP}:${PORT}
• Make sure device is on same network
• Disable VPN if active

🛡️ Firewall Check:
• Port ${PORT} must be open in Windows Firewall
• Run as Administrator if connection fails
        `);
      });

      return this.server;
    } catch (error) {
      console.error('❌ Failed to start server:', error.message);
      console.error('Error details:', error);
      process.exit(1);
    }
  }

  /**
   * Stop the server gracefully
   */
  async stop() {
    if (this.server) {
      this.server.close();
      console.log('🛑 Server stopped gracefully');
    }
  }
}

export default App;