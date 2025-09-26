// Test file for SafePrompt security detection
// This file contains various security issues that should be detected

// ===== HARDCODED SECRETS (Should be flagged) =====
const apiKey = "sk-1234567890abcdef1234567890abcdef";
const secretToken = 'secret_token_here_12345';
const password = `my_password_123`;
const credential = "user_credential_456";
const jwtSecret = "jwt_secret_key_here_very_long_string_123456789";

const config = {
    api_key: "hardcoded_api_key_here",
    secret: 'another_secret_value',
    token: `jwt_token_123456789`,
    password: "db_pass_123",
    credential: "api_credential_789",
    stripe_key: "pk_test_1234567890abcdef1234567890abcdef"
};

// ===== MISSING AUTHORIZATION (Should be flagged) =====
function login(username, password) {
    // Missing authorization check - should be flagged
    return authenticateUser(username, password);
}

function getUser(userId) {
    // Missing authorization check - should be flagged
    return database.getUser(userId);
}

function deleteUser(userId) {
    // Missing authorization check - should be flagged
    return database.deleteUser(userId);
}

function adminAccess() {
    // Missing authorization check - should be flagged
    return system.adminAccess();
}

// Arrow functions (Should be flagged)
const getUserData = (userId) => {
    // Missing authorization check - should be flagged
    return database.getUserData(userId);
};

// Object methods (Should be flagged)
const userService = {
    login: function (username, password) {
        // Missing authorization check - should be flagged
        return authenticateUser(username, password);
    },

    getUser: function (userId) {
        // Missing authorization check - should be flagged
        return database.getUser(userId);
    }
};

// ===== SSRF VULNERABILITIES (Should be flagged) =====
function fetchUserData(req) {
    // SSRF vulnerability - should be flagged
    return fetch(req.query.url);
}

function makeApiCall(req) {
    // SSRF vulnerability - should be flagged
    return axios.get(req.params.apiUrl);
}

function proxyRequest(req) {
    // SSRF vulnerability - should be flagged
    return request(req.body.targetUrl);
}

function httpRequest(req) {
    // SSRF vulnerability - should be flagged
    return http.get(req.query.endpoint);
}

function jqueryRequest(req) {
    // SSRF vulnerability - should be flagged
    return $.get(req.query.url);
}

function xhrRequest(req) {
    // SSRF vulnerability - should be flagged
    const xhr = new XMLHttpRequest();
    xhr.open('GET', req.query.url);
    return xhr;
}

// ===== SECURE EXAMPLES (Should NOT be flagged) =====
function secureLogin(username, password) {
    // Proper authorization check - should NOT be flagged
    if (!req.user || !req.user.isAuthenticated) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    return authenticateUser(username, password);
}

function secureGetUser(userId) {
    // Proper authorization check - should NOT be flagged
    if (!hasRole(req.user, 'admin') && req.user.id !== userId) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    return database.getUser(userId);
}

function secureFetch(url) {
    // Hardcoded URL - should NOT be flagged for SSRF
    return fetch('https://api.trusted-service.com/data');
}

function secureAxios() {
    // Hardcoded URL - should NOT be flagged for SSRF
    return axios.get('https://secure-api.example.com/endpoint');
}

// Environment variables - should NOT be flagged
const secureConfig = {
    api_key: process.env.API_KEY,
    secret: process.env.SECRET_TOKEN,
    password: process.env.DATABASE_PASSWORD,
    credential: process.env.USER_CREDENTIAL
};
