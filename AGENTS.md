# Project Spec

## Problem Statement

I want to create a Chrome extension with AI capabilities for doing AI-powered outreach on LinkedIn. The extension will help automate and optimize LinkedIn messaging by scraping conversations, using AI for message reflection/analysis, and providing a visual sequencer for orchestrating outreach campaigns.

## Infrastructure

Tools and services to use:
- **MongoDB** - Store scraped LinkedIn contacts, conversations, and feedback data
- **Gemini 3.5 API** - AI capabilities for message analysis and self-reflection
- **Chrome Extension** - Frontend interface

## Features

The following features need to be implemented one after another:

### Phase 1: Core UI
1. **Home Dashboard** - Agent opens a home page with dashboard and summary
2. **Messages Tab** - Left sidebar showing inbox of all ongoing conversations
3. **Sequencer Tab** - Canvas where user can specify actions to take (delays, hardcoded messages, AI customized messages)

### Phase 2: AI Integration
4. **AI Self-Reflection** - Use Gemini 3.5 to analyze messages and present results in the Messages tab
5. **User Feedback System** - Record user feedback on what constitutes a good vs bad message
6. **Model Fine-tuning** - Train on messages and feedback to fine-tune a model

## Context Data Integration

Fetch and store context data for each recipient to enable personalized AI outreach:

1. **LinkedIn Profile** - Fetch recipient's LinkedIn page and profile info
2. **Company Information** - Fetch their current company name and details
3. **Email Conversations** - Fetch previous conversations with them via email
4. **Common Connections** - Find mutual connections between user and recipient
5. **Social Posts** - Fetch their LinkedIn and Facebook posts
6. **Interest Filtering** - Filter for connections you already know or themes they discuss that interest you
7. **Context Editing** - Allow user to edit fetched context or click yes/no to confirm
8. **Feedback Storage** - Store context feedback in MongoDB for future model training

## Technical Stack (TBD)
- Chrome Extension
- MongoDB for data storage
- Gemini 3.5 API for AI capabilities
- Visual canvas for sequencer