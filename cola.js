const mysql = require('mysql2/promise');

// Configura aquí tus datos de acceso a MySQL
const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',      // Cambia si tienes otro usuario
    password: '',      // Pon tu contraseña si la tienes
    database: 'sistema_bot',
    waitForConnections: true,
    connectionLimit: 50,
    queueLimit: 0
});

module.exports = { pool };