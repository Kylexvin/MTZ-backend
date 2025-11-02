// src/config/env.js
import { config } from 'dotenv';

class Environment {
  /**
   * Load and validate environment variables
   * Must be called before any other application code
   */
  static load() {
    // 📁 Load environment variables from .env file
    const result = config();
    
    if (result.error) {
      console.warn('⚠️  .env file not found, using system environment variables');
    } else {
      console.log('✅ .env file loaded successfully');
    }

    // 🛡️ Validate required environment variables
    const required = [
      'MONGODB_URI',
      'JWT_SECRET',
      'PORT'
    ];

    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
      throw new Error(`❌ Missing required environment variables: ${missing.join(', ')}`);
    }

    // 🔧 Set default values for optional variables
    const defaults = {
      NODE_ENV: 'development',
      PORT: 5000,
      JWT_EXPIRES_IN: '30d',
      LOG_LEVEL: 'info',
      CORS_ORIGIN: 'http://localhost:3000'
    };

    for (const [key, value] of Object.entries(defaults)) {
      if (!process.env[key]) {
        process.env[key] = value;
        console.log(`🔧 Set default ${key}=${value}`);
      }
    }

    // 🚨 Security warnings in development
    if (this.isDevelopment()) {
      if (process.env.JWT_SECRET === 'your_super_secure_jwt_secret_key_min_32_chars') {
        console.warn('⚠️  Using default JWT secret - Change in production!');
      }
      if (process.env.MONGODB_URI.includes('localhost')) {
        console.warn('⚠️  Using local MongoDB - Use Atlas in production!');
      }
    }

    console.log('✅ Environment configuration loaded successfully');
  }

  /**
   * Get environment variable with type conversion
   */
  static get(key, defaultValue = null) {
    const value = process.env[key] || defaultValue;
    
    // 🔄 Type conversion for common patterns
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (!isNaN(value) && value !== '') return Number(value);
    
    return value;
  }

  /**
   * Check if running in production environment
   */
  static isProduction() {
    return this.get('NODE_ENV') === 'production';
  }

  /**
   * Check if running in development environment
   */
  static isDevelopment() {
    return this.get('NODE_ENV') === 'development';
  }

  /**
   * Check if running in test environment
   */
  static isTest() {
    return this.get('NODE_ENV') === 'test';
  }

  /**
   * Get safe environment info (hides sensitive data)
   */
  static getInfo() {
    return {
      NODE_ENV: this.get('NODE_ENV'),
      PORT: this.get('PORT'),
      MONGODB_URI: this.maskSensitive(this.get('MONGODB_URI')),
      JWT_SECRET: this.maskSensitive(this.get('JWT_SECRET')),
      JWT_EXPIRES_IN: this.get('JWT_EXPIRES_IN'),
      LOG_LEVEL: this.get('LOG_LEVEL'),
      CORS_ORIGIN: this.get('CORS_ORIGIN'),
    };
  }

  /**
   * Mask sensitive information for logging
   */
  static maskSensitive(value) {
    if (!value) return null;
    
    if (value.includes('mongodb')) {
      // Mask MongoDB password: mongodb://user:pass@host -> mongodb://user:***@host
      return value.replace(/:([^@]+)@/, ':***@');
    }
    
    if (value.length > 8) {
      return value.substring(0, 4) + '***' + value.substring(value.length - 4);
    }
    
    return '***';
  }

  /**
   * Validate all environment variables meet requirements
   */
  static validate() {
    const issues = [];

    // JWT Secret strength
    const jwtSecret = this.get('JWT_SECRET');
    if (jwtSecret && jwtSecret.length < 32) {
      issues.push('JWT_SECRET should be at least 32 characters long');
    }

    // MongoDB URI format
    const mongoUri = this.get('MONGODB_URI');
    if (mongoUri && !mongoUri.startsWith('mongodb')) {
      issues.push('MONGODB_URI should start with mongodb:// or mongodb+srv://');
    }

    // Port range
    const port = this.get('PORT');
    if (port && (port < 1024 || port > 65535)) {
      issues.push('PORT should be between 1024 and 65535');
    }

    if (issues.length > 0) {
      console.warn('⚠️  Environment validation issues:');
      issues.forEach(issue => console.warn(`   - ${issue}`));
    }

    return issues;
  }
}

export default Environment;