// generate-config.js (CORRIGIDO PARA PRODUÇÃO)

const fs = require('fs');

// Crie o conteúdo do arquivo de configuração
// A única mudança é adicionar "export" no início da linha.
const configContent = `
export const firebaseConfig = {
  apiKey: "${process.env.PUBLIC_FIREBASE_API_KEY}",
  authDomain: "${process.env.PUBLIC_FIREBASE_AUTH_DOMAIN}",
  projectId: "${process.env.PUBLIC_FIREBASE_PROJECT_ID}",
  storageBucket: "${process.env.PUBLIC_FIREBASE_STORAGE_BUCKET}",
  messagingSenderId: "${process.env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID}",
  appId: "${process.env.PUBLIC_FIREBASE_APP_ID}"
  measurementId: "${process.env.PUBLIC_FIREBASE_MEASUREMENT_ID}"
};
`;

// Escreva o conteúdo no arquivo firebase-config.js
fs.writeFile('firebase-config.js', configContent, (err) => {
  if (err) {
    console.error('Error writing firebase config file', err);
    process.exit(1);
  }
  console.log('Firebase config file for production generated successfully!');
});