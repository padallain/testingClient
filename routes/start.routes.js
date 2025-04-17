const express = require('express');
const { register} = require('../controllers/auth.controllers');
const router = express.Router();


router.use(express.json()); 

// Auth routes
router.get('/', (req, res) => {
  res.send('You have to log in.');
});
router.post('/saveClient', register);



module.exports = router;
