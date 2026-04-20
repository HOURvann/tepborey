// js/firebase-config.js

const firebaseConfig = {
  apiKey: "AIzaSyACqpa4ekS31tjcRYzm5nvAhbPrB5AeQSo",
  authDomain: "tepborey.firebaseapp.com",
  projectId: "tepborey",
  storageBucket: "tepborey.firebasestorage.app",
  messagingSenderId: "664591849926",
  appId: "1:664591849926:web:57e0ddbb7f505ec0e87ac7",
  measurementId: "G-LWQL54P5VX"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// បង្កើត Variable 'db' សម្រាប់ប្រើជាមួយ Firestore (Database) ក្នុង Project ទាំងមូល
const db = firebase.firestore();