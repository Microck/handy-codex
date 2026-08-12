# Handy Codex

[![Discord](https://img.shields.io/badge/Discord-%235865F2.svg?style=for-the-badge&logo=discord&logoColor=white)](https://discord.com/invite/WVBeWsNXK4)

**A free, open source, and extensible speech-to-text application that works completely offline. Now with ChatGPT / Codex ASR**

Handy Codex is a fork of [Handy](https://github.com/cjpais/Handy), a cross-platform desktop application that provides simple, privacy-focused speech transcription. Press a shortcut, speak, and have your words appear in any text field. This happens on your own computer without sending any information to the cloud.

## wtf (why this fork)

I wanted Handy's local speech-to-text workflow with an additional Codex-powered option. Upstream Handy is built around local models. This fork adds **ChatGPT / Codex** as a selectable transcription provider, so you can use your existing Codex login for remote transcription when you prefer it.

What is different here:

- **Codex transcription**: choose ChatGPT / Codex from the model selector. Handy Codex reads the existing Codex `auth.json` login and sends recordings to the ChatGPT transcription endpoint. No separate API key is required.
- **Local models remain available**: Whisper, Parakeet, and the existing offline workflow are still included. Codex is an additional option, not a replacement for local transcription.

This is not an official Handy release and is not affiliated with or endorsed by the Handy maintainers. The fork follows upstream changes through its own repository so these additions can evolve independently.

For the upstream project, see [cjpais/Handy](https://github.com/cjpais/Handy). For this fork's releases, issues, and changes, use [Microck/handy-codex](https://github.com/Microck/handy-codex).


<img width="680" height="566" alt="image" src="https://github.com/user-attachments/assets/7ef29b6b-8751-4c00-8d81-dbbb2c767ce9" />


## Quick Start

### Installation

1. Download the latest Handy Codex release from the [releases page](https://github.com/Microck/handy-codex/releases)
   - The upstream Homebrew cask and winget package install Handy, not Handy Codex.
2. Install the application
3. **macOS**: the app is not notarized, so macOS Gatekeeper will block the first launch. Right-click (or Control-click) the app and select **Open**, then click **Open** again in the dialog. If that doesn't work (macOS Sequoia+), go to **System Settings → Privacy & Security**, scroll to Security, and click **Open Anyway**. You only need to do this once.
4. Launch Handy and grant necessary system permissions (microphone, accessibility)
5. Configure your preferred keyboard shortcuts in Settings
6. Start transcribing!

 ### Development Setup
 
 For detailed build instructions including platform-specific requirements, see [BUILD.md](BUILD.md).
 
## License

MIT License - see [LICENSE](LICENSE) file for details.

Handy is open-source software, but the Handy name, logo, icon, and brand assets are not open-source. Unofficial forks, rewrites, and redistributions must use their own branding and must not imply endorsement or affiliation.
