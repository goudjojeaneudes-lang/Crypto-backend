Turequire('dotenv').config();
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
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch (err) {
    res.status(401).json({ message: 'Token invalide ou expiré.' });
  }
};

// --- CALCUL DES RENDEMENTS JOURNALIERS (CRON JOB) ---
cron.schedule('0 0 * * *', async () => {
  console.log('🔄 Calcul des rendements d\'investissement journaliers...');
  try {
    const activeInvestments = await Investment.find({ status: 'ACTIVE' });
    for (const inv of activeInvestments) {
      const dailyGain = inv.amount * (inv.dailyReturnRate / 100);
      
      // Créditer le solde de l'utilisateur
      await User.findByIdAndUpdate(inv.userId, { $inc: { balance: dailyGain } });
      
      inv.daysCompleted += 1;
      inv.totalEarned += dailyGain;
      
      // Fin du contrat d'investissement
      if (inv.daysCompleted >= inv.durationDays) {
        inv.status = 'COMPLETED';
        // Restitution du capital initial
        await User.findByIdAndUpdate(inv.userId, { $inc: { balance: inv.amount } });
      }
      
      await inv.save();
    }
    console.log(`✅ ${activeInvestments.length} placements crédités avec succès.`);
  } catch (error) {
    console.error('❌ Erreur lors du calcul des rendements:', error);
  }
});

// --- ROUTES API REST ---

// Route racine
app.get('/', (req, res) => {
  res.json({
    status: 'Online',
    message: 'API CryptoInvest opérationnelle !',
    timestamp: new Date()
  });
});

// Inscription
app.post('/api/auth/register', async (req, res) => {
  try {
    const { fullName, email, password, referralCode } = req.body;
    
    if (!fullName || !email || !password) {
      return res.status(400).json({ message: 'Veuillez remplir tous les champs obligatoires.' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ message: 'Cet email est déjà utilisé.' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const userReferralCode = 'REF-' + Math.random().toString(36).substring(2, 8).toUpperCase();

    const user = new User({
      fullName,
      email,
      password: hashedPassword,
      referralCode: userReferralCode,
      referredBy: referralCode || null
    });

    await user.save();
    res.status(201).json({ message: 'Compte créé avec succès !' });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ message: "Erreur serveur lors de l'inscription." });
  }
});

// Connexion
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: 'Identifiants invalides.' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Identifiants invalides.' });

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({
      token,
      user: { id: user._id, fullName: user.fullName, email: user.email }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Erreur serveur lors de la connexion.' });
  }
});

// Profil utilisateur
app.get('/api/user/profile', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    const investments = await Investment.find({ userId: req.userId }).sort({ startDate: -1 });
    const transactions = await Transaction.find({ userId: req.userId }).sort({ createdAt: -1 });
    res.json({ user, investments, transactions });
  } catch (err) {
    res.status(500).json({ message: 'Erreur lors de la récupération des données.' });
  }
});

// Nouvel investissement
app.post('/api/invest', authMiddleware, async (req, res) => {
  try {
    const { type, assetName, amount, dailyReturnRate, durationDays } = req.body;
    const user = await User.findById(req.userId);

    if (user.balance < amount) {
      return res.status(400).json({ message: 'Solde insuffisant pour souscrire à cette offre.' });
    }

    user.balance -= amount;
    await user.save();

    const investment = new Investment({
      userId: req.userId,
      type,
      assetName,
      amount,
      dailyReturnRate,
      durationDays
    });

    await investment.save();
    res.json({ message: 'Investissement activé avec succès !', investment });
  } catch (err) {
    res.status(500).json({ message: "Erreur lors de la création de l'investissement." });
  }
});

// Dépôts et Retraits
app.post('/api/transaction', authMiddleware, async (req, res) => {
  try {
    const { type, method, amount, reference } = req.body;
    const user = await User.findById(req.userId);

    if (type === 'WITHDRAWAL' && user.balance < amount) {
      return res.status(400).json({ message: 'Solde insuffisant pour ce retrait.' });
    }

    if (type === 'WITHDRAWAL') {
      user.balance -= amount;
      await user.save();
    }

    const transaction = new Transaction({
      userId: req.userId,
      type,
      method,
      amount,
      reference
    });

    await transaction.save();
    res.json({ message: 'Demande enregistrée. En attente de validation.', transaction });
  } catch (err) {
    res.status(500).json({ message: 'Erreur lors de la transaction.' });
  }
});// --- NOUVELLE ROUTE : Génération d'adresse de dépôt Tatum ---
const { TatumSdk, Network, CryptoCurrency } = require('@tatumio/tatum');

app.post('/api/deposit/address', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: "L'identifiant utilisateur (userId) est requis." });
    }

    const tatum = await TatumSdk.init({
      network: process.env.TATUM_NETWORK || Network.TRON_NILE,
      apiKey: {
        v1: process.env.TATUM_API_KEY
      }
    });
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

