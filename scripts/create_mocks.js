const fs = require('fs');
const path = require('path');

const mocksDir = path.join(__dirname, '../tests/mock_projects');

const mocks = [
    {
        name: 'static-react',
        files: {
            'package.json': JSON.stringify({ dependencies: { react: "^18.0.0", vite: "^4.0.0" } }),
            'index.html': '<div id="root"></div>'
        }
    },
    {
        name: 'next-ssr',
        files: {
            'package.json': JSON.stringify({ dependencies: { next: "13.0.0" }, scripts: { build: "next build", start: "next start" } }),
            'next.config.js': 'module.exports = {}'
        }
    },
    {
        name: 'next-static',
        files: {
            'package.json': JSON.stringify({ dependencies: { next: "13.0.0" }, scripts: { build: "next build && next export" } }),
            'next.config.js': 'module.exports = { output: "export" }'
        }
    },
    {
        name: 'express-container',
        files: {
            'package.json': JSON.stringify({ dependencies: { express: "^4.18.0" } }),
            'Dockerfile': 'FROM node:18\nCMD ["node", "app.js"]'
        }
    },
    {
        name: 'monorepo',
        files: {
            'package.json': JSON.stringify({ workspaces: ["packages/*"], private: true }),
            'packages/client/package.json': JSON.stringify({ dependencies: { react: "18.0.0" } }),
            'packages/server/package.json': JSON.stringify({ dependencies: { express: "4.18.0" } })
        },
        dirs: ['packages/client', 'packages/server']
    }
];

if (!fs.existsSync(mocksDir)) fs.mkdirSync(mocksDir, { recursive: true });

mocks.forEach(mock => {
    const mockPath = path.join(mocksDir, mock.name);
    if (!fs.existsSync(mockPath)) fs.mkdirSync(mockPath, { recursive: true });

    if (mock.dirs) {
        mock.dirs.forEach(d => {
            const dPath = path.join(mockPath, d);
            if (!fs.existsSync(dPath)) fs.mkdirSync(dPath, { recursive: true });
        });
    }

    Object.entries(mock.files).forEach(([file, content]) => {
        fs.writeFileSync(path.join(mockPath, file), content);
    });
});

console.log('✅ Mocks created successfully.');
