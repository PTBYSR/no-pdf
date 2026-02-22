require('dotenv').config();
const { MongoClient } = require('mongodb');

async function testConnection() {
    console.log('--- Testing MongoDB Connection ---');

    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error('❌ MONGODB_URI is missing in .env');
        process.exit(1);
    }

    console.log(`Connecting to: ${uri}`);

    const client = new MongoClient(uri);

    try {
        await client.connect();
        console.log('✅ Connection SUCCESSFUL!');

        const dbName = 'child_safety_app';
        const db = client.db(dbName);
        console.log(`Connected to database: ${dbName}`);

        // Optional: List collections to prove it works
        const collections = await db.listCollections().toArray();
        console.log('Collections:', collections.map(c => c.name));

    } catch (err) {
        console.error('❌ Connection FAILED:', err.message);
    } finally {
        await client.close();
        console.log('--- Test Complete ---');
    }
}

testConnection();
