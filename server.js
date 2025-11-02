// server.js
import Environment from './src/config/env.js';

/**
 * 🥛 MilkBank Backend Server Entry Point
 * Loads environment, initializes app, and starts server
 */

// Load environment variables first
Environment.load();

// Import app after environment is loaded
import App from './src/app.js';

const app = new App();

// 🚀 Start the application
app.start();

// 🛑 Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Received SIGINT - Shutting down gracefully...');
  await app.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('🛑 Received SIGTERM - Shutting down gracefully...');
  await app.stop();
  process.exit(0);
});

export default app;