const express = require('express');
const authRoutes = require('./auth.routes');
const usersRoutes = require('./users.routes');
const employeesRoutes = require('./employees.routes');
const shiftsRoutes = require('./shifts.routes');
const schedulesRoutes = require('./schedules.routes');
const operationsRoutes = require('./operations.routes');

const router = express.Router();
router.use('/auth', authRoutes);
router.use('/users', usersRoutes);
router.use('/employees', employeesRoutes);
router.use('/shift-types', shiftsRoutes);
router.use('/schedules', schedulesRoutes);
router.use('/schedule-calendar', schedulesRoutes);
router.use('/', operationsRoutes);
module.exports = router;
