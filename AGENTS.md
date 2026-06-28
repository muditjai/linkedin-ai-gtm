# Project Spec

## Code Guidelines

### Modular Code & Test Cases
- Always read the code first before making any changes.
- Stop adding any bugs as they waste a lot of time. reason properly and deeply about the potential errors before making changes
- After making any significant change, always submit to git.
- Keep code modular - split large files into smaller, focused modules
- Don't create super long files - if a file exceeds ~300 lines, consider splitting it
- Write test cases for new functionality where appropriate
- Use descriptive naming conventions aligned with the existing codebase
- When implementing features, ensure they are properly validated
- Always prefer typed languages eg ts over js and python type annotations wherever available and possible.

## Problem Statement

Build a Chrome extension with AI-powered outreach capabilities for LinkedIn. The product should help users automate and optimize LinkedIn messaging by scraping conversations, analyzing message quality, and orchestrating outreach campaigns through a visual sequencer.

## Architecture and Infrastructure

### Core stack
- **Frontend:** Chrome extension
- **Service Backend:** Containerized service layer for frontend requests and business logic
- **Agent Backend:** LangGraph-based agent backend
- **Hosting:** DigitalOcean
- **Database:** MongoDB

### AI services
- **Gemini 3.5:** Use for message reflection, analysis, and contextual understanding
- **Message generation model:** Use an LLM from the DigitalOcean model list, for example `gpt-oss-20b` or another supported option

## Feature Roadmap

### Phase 1: Core frontend UI
1. **Home Dashboard** - Provide a landing experience with an overview dashboard and summary, including tasks such as messages to reply to, previously sent messages, replies received, positive and negative outcomes, actionable follow-ups, and scraping status or errors.
2. **Messages Tab** - Show an inbox-style view of ongoing conversations with a left-side contact list and a right-side conversation thread view.
3. **Sequencer Tab** - Provide a canvas for defining outreach actions such as delays, fixed messages, and AI-generated personalized messages.
4. **Scraping functionality** - Read the LinkedIn messages page and load conversations into the service backend gradually to reduce the risk of account bans.

### Phase 2: Service backend
- Provide standard endpoints for CRUD operations on message threads and sequencer data.
- Handle storage, updates, and retrieval of conversations, sequencer definitions, and related metadata.
- Support sequencer execution so the agent can evaluate a conversation and decide the next best message while considering context and previous feedback.

### Phase 3: AI integration
1. **AI Self-Reflection** - Analyze outbound and inbound messages and present insights in the Messages tab.
2. **User Feedback System** - Capture feedback on what makes a good versus a bad message.
3. **Model Fine-Tuning** - Use message and feedback data to improve future message generation.

## Context Data Integration

For each recipient, collect and store context that can improve personalization:

1. **LinkedIn Profile** - Fetch public profile details and professional background.
2. **Company Information** - Retrieve the current company name and relevant company context.
3. **Email Conversations** - Pull prior email conversations with the recipient if available.
4. **Common Connections** - Identify shared connections between the user and recipient.
5. **Social Posts** - Review LinkedIn or Facebook posts that may reveal interests or recent activity.
6. **Interest Filtering** - Prioritize connections or themes the user already knows or cares about.
7. **Context Editing** - Let the user review, edit, or approve fetched context before use.
8. **Feedback Storage** - Save context feedback into MongoDB for future model training.

## Configuration and Secrets

- Store the Gemini API key in a local gitignored file such as `.env.local`.
- Keep secrets out of the repository and out of any committed config files.
- Use environment variables for API keys and service credentials.
