Package the extension as a .vsix file for local installation:

1. Make sure the code compiles cleanly first (`npm run compile`)
2. Run `npx @vscode/vsce package` to create the .vsix
3. If there are warnings about missing fields (repository, license, etc.), fix them in package.json
4. Tell me the exact command to install it: `code --install-extension <filename>.vsix`
5. Remind me to reload VS Code after installing
