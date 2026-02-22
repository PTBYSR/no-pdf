const { initAuthCreds, BufferJSON, proto } = require('@whiskeysockets/baileys');

// Helper to convert JSON string back to object/buffer
const bufferReviver = (key, value) => {
    if (value && value.type === 'Buffer' && Array.isArray(value.data)) {
        return Buffer.from(value.data);
    }
    return value;
};

const useMongoDBAuthState = async (collection) => {
    // 1. Read Data Helper
    const readData = async (id) => {
        try {
            const data = await collection.findOne({ _id: id });
            if (data && data.value) {
                // Parse the JSON string, reviving Buffers
                return JSON.parse(data.value, bufferReviver);
            }
            return null;
        } catch (error) {
            console.error(`Error reading ${id} from DB:`, error);
            return null;
        }
    };

    // 2. Write Data Helper
    const writeData = async (data, id) => {
        try {
            // Stringify with Buffer handling
            const value = JSON.stringify(data, BufferJSON.replacer);
            await collection.updateOne(
                { _id: id },
                { $set: { _id: id, value } },
                { upsert: true }
            );
        } catch (error) {
            console.error(`Error writing ${id} to DB:`, error);
        }
    };

    // 3. Remove Data Helper
    const removeData = async (id) => {
        try {
            await collection.deleteOne({ _id: id });
        } catch (error) {
            console.error(`Error removing ${id} from DB:`, error);
        }
    };

    // Initialize credentials
    const creds = (await readData('creds')) || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(
                        ids.map(async (id) => {
                            let value = await readData(`${type}-${id}`);
                            if (type === 'app-state-sync-key' && value) {
                                value = proto.Message.AppStateSyncKeyData.fromObject(value);
                            }
                            data[id] = value;
                        })
                    );
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            if (value) {
                                tasks.push(writeData(value, key));
                            } else {
                                tasks.push(removeData(key));
                            }
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: async () => {
            return await writeData(creds, 'creds');
        }
    };
};

module.exports = { useMongoDBAuthState };
