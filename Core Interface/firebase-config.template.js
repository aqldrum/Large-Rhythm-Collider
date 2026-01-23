// firebase-config.template.js
// Duplicate this file as firebase-config.js (which should be gitignored) and populate
// the configuration object with your Firebase project credentials.
//
//   firebaseConfig.apiKey = '...';
//   firebaseConfig.authDomain = '...';
//   firebaseConfig.projectId = '...';
//   firebaseConfig.storageBucket = '...';
//   firebaseConfig.messagingSenderId = '...';
//   firebaseConfig.appId = '...';
//
// Place the copy in the same directory so Collections.js can initialize Firebase.

window.firebaseConfig = {
    apiKey: 'YOUR_API_KEY',
    authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
    projectId: 'YOUR_PROJECT_ID',
    storageBucket: 'YOUR_PROJECT_ID.appspot.com',
    messagingSenderId: 'YOUR_SENDER_ID',
    appId: 'YOUR_APP_ID'
    // NOTE: Firestore does not require databaseURL when using projectId + default instance.
};

