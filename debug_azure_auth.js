require('dotenv').config();
const msal = require('@azure/msal-node');

const msalConfig = {
    auth: {
        clientId: process.env.AZURE_CLIENT_ID,
        authority: "https://login.microsoftonline.com/common",
        clientSecret: process.env.AZURE_CLIENT_SECRET,
    }
};

const cca = new msal.ConfidentialClientApplication(msalConfig);

async function generateUrl() {
    const authCodeUrlParameters = {
        scopes: [
            "https://management.azure.com/user_impersonation",
            "User.Read",
            "openid",
            "profile",
            "offline_access"
        ],
        redirectUri: process.env.AZURE_REDIRECT_URI,
        state: 'debug_final_test',
        prompt: 'select_account',
        authority: "https://login.microsoftonline.com/common"
    };

    try {
        const url = await cca.getAuthCodeUrl(authCodeUrlParameters);
        console.log("\n🧪 --- DEBUG AUTH URL ---");
        console.log(url);
        console.log("\n------------------------");
        console.log("Please copy the URL above and paste it into an INCOGNITO/PRIVATE browser window.");
    } catch (error) {
        console.error("Error generating URL:", error);
    }
}

generateUrl();
