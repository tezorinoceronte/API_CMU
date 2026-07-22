// test.js
const axios = require('axios');
axios.post('http://localhost:3000/api/solicitar-consulta', {
    userId: 'test_user_01',
    numero: '5512345678',
    portal: 'FORCE'
}).then(res => console.log('Tarea enviada, ID:', res.data.tareaId));
