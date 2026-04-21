const fs = require('fs');
const path = require('path');

const directory = __dirname;

fs.readdir(directory, (err, files) => {
    if (err) throw err;

    let deletedCount = 0;

    for (const file of files) {
        if (file.startsWith('auth_info_')) {
            const folderPath = path.join(directory, file);
            console.log(`Deleting ${folderPath}...`);
            fs.rmSync(folderPath, { recursive: true, force: true });
            deletedCount++;
        }
    }

    if (deletedCount === 0) {
        console.log('No auth folders found to delete.');
    } else {
        console.log(`\nSuccessfully deleted ${deletedCount} auth folders! You can now start fresh.`);
    }
});
