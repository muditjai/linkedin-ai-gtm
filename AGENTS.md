# Project Spec

## Problem Statement

I want to create a Chrome extension with AI capabilities for doing AI-powered outreach on LinkedIn. The extension will help automate and optimize LinkedIn messaging by scraping conversations, using AI for message reflection/analysis, and providing a visual sequencer for orchestrating outreach campaigns.

## Feature Roadmap

The following features need to be implemented one after another:

### Phase 1: Core Infrastructure
1. **Home Dashboard** - Agent opens a home page with dashboard and summary
2. **Messages Tab** - Left sidebar showing inbox of all ongoing conversations
3. **LinkedIn Scraping** - Ability to scrape LinkedIn messages page and extract all conversations with text extraction
4. **MongoDB Backend** - Store scraped LinkedIn contacts and conversations

### Phase 2: AI Integration
5. **Sequencer Tab** - Canvas where user can specify actions to take (delays, hardcoded messages, AI customized messages)
6. **AI Self-Reflection** - Use Gemini 3.5 to analyze messages and present results in the Messages tab
7. **User Feedback System** - Record user feedback on what constitutes a good vs bad message
8. **Model Fine-tuning** - Train on messages and feedback to fine-tune a model

## Technical Stack (TBD)
- Chrome Extension
- MongoDB for data storage
- Gemini 3.5 API for AI capabilities
- Visual canvas for sequencer