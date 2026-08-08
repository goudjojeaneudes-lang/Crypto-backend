require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const cron = require('node-cron');

const User = require('./models/User');
const Investment = require('./models/Investment');
const Transaction = require('./models/Transaction');

const app = express();

// Middleware
app.use(express.json());
app.use(cors({ origin: '*' }));

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'defaut_secret_key_2026';

// Connexion MongoDB Atlas
if (!process.env.MONGODB_URI) {
  console.warn("⚠️ ATTENTION : La variable MONGODB_URI n'est pas définie !");
}

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Connecté avec succès à MongoDB Atlas'))
  .catch(err => console.error('❌ Erreur de connexion MongoDB Atlas:', err));

// Middleware d'Authentification JWT
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).json({ message: 'Accès refusé. Token manquant.' });
  
  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Format du token invalide.' });

  try {
    const verified = jwt.verify(token, JWT_SECRET);
    req.user = verified;
    next();
  } catch (err) {
    res.status(403).json({ message: 'Token invalide ou expiré.' });
  }
};

// Route pour générer ou récupérer l'adresse de dépôt (sans package externe Tatum)
app.post('/api/deposit/address', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: "L'identifiant utilisateur (userId) est requis." });
    }

    const network = process.env.TATUM_NETWORK || 'tron-nile';
    const response = await fetch(`https://api.tatum.io/v3/${network}/wallet`, {
      method: 'GET',
      headers: {
        'x-api-key': process.env.TATUM_API_KEY
      }
    });

    if (!response.ok) {
      throw new Error("Erreur lors de la communication avec l'API Tatum");
    }

    const wallet = await response.json();
    const depositAddress = wallet.address || wallet.xpub;

    let user = await User.findOne({ userId });
    if (!user) {
      user = new User({ userId, depositAddress });
    } else {
      user.depositAddress = depositAddress;
    }
    await user.save();

    return res.status(200).json({
      success: true,
      message: "Adresse de dépôt générée avec succès",
      data: {
        userId: user.userId,
        depositAddress: user.depositAddress,
        network: network
      }
    });

  } catch (error) {
    console.error("Erreur Tatum :", error);
    return res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => console.log(`🚀 Serveur en ligne sur le port ${PORT}`));
