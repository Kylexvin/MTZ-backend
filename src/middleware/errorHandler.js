// src/middleware/errorHandler.js
class ErrorHandler {
  /**
   * Handle 404 - Route not found
   */
  static notFound(req, res, next) {
    const error = new Error(`Not found - ${req.originalUrl}`);
    res.status(404);
    next(error);
  }

  /**
   * Global error handler
   * Handles all application errors in one place
   */
  static errorHandler(err, req, res, next) {
    let error = { ...err };
    error.message = err.message;

    // Log error for debugging
    console.error('🔥 Error:'.red, err);

    // Mongoose bad ObjectId
    if (err.name === 'CastError') {
      const message = 'Resource not found';
      error = { message, statusCode: 404 };
    }

    // Mongoose duplicate key
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern)[0];
      const message = `${field.charAt(0).toUpperCase() + field.slice(1)} already exists`;
      error = { message, statusCode: 400 };
    }

    // Mongoose validation error
    if (err.name === 'ValidationError') {
      const message = Object.values(err.errors).map(val => val.message).join(', ');
      error = { message, statusCode: 400 };
    }

    // JWT errors
    if (err.name === 'JsonWebTokenError') {
      const message = 'Invalid token';
      error = { message, statusCode: 401 };
    }

    if (err.name === 'TokenExpiredError') {
      const message = 'Token expired';
      error = { message, statusCode: 401 };
    }

    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Server Error',
      stack: process.env.NODE_ENV === 'production' ? null : err.stack
    });
  }
}

// ✅ Export as named exports
export const notFound = ErrorHandler.notFound;
export const errorHandler = ErrorHandler.errorHandler;

// ✅ Also export default for flexibility
export default ErrorHandler;