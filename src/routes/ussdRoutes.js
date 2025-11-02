// routes/ussdRoutes.js
import express from 'express';
import UssdController from '../controllers/ussdController.js';

const router = express.Router();

// USSD endpoint
router.post('/', UssdController.handleUssdRequest);

export default router;