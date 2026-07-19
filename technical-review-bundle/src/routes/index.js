const express = require('express');
const authRoutes = require('./auth.routes');
const usersRoutes = require('./users.routes');
const employeesRoutes = require('./employees.routes');

const router = express.Router();
router.use('/auth', authRoutes);
router.use('/users', usersRoutes);
router.use('/employees', employeesRoutes);
module.exports = router;
