# Clarity AI - Evaluation Test Cases

These test cases are designed to evaluate Clarity AI's ability to:
1. Understand a target codebase
2. Ask clarifying questions when requirements are ambiguous
3. Implement changes and create working PRs
4. Avoid unnecessary questions when requirements are clear

---

## Test Case 1: Feature with Ambiguous Requirements

**Issue Title:** Allow users to set custom daily learning goals

**Issue Body:**
```
Add a feature that lets users set their own daily goals (e.g., "Complete 3 tasks", "Earn 50 points", "Practice for 15 minutes"). Currently the app has streak tracking but no customizable goals.

Requirements:
- Add a "Set Goal" button on the home screen
- Allow users to choose from preset goals or create custom ones
- Show progress towards the daily goal on the dashboard
- Send a push notification when goal is achieved
```

**Labels:** `feature`, `clarity-ai`

**Expected Behavior:**
- Should ask clarifying questions about:
  - Goal reset timing (daily at midnight? user timezone?)
  - Preset goal options to include
  - UI placement specifics
- Should identify relevant feature and DB schema files

**Complexity:** Medium-High (Frontend + Backend + DB schema)

---

## Test Case 2: Bug Report with Clear Steps

**Issue Title:** Streak freezes not being applied correctly on weekends

**Issue Body:**
```
Users report that streak freezes are not being applied correctly when they miss activity on Saturday or Sunday. The streak resets even when they have freezes available.

Steps to reproduce:
1. Purchase a streak freeze from the store
2. Skip Saturday completely (no activities)
3. Open app on Sunday - streak shows as reset to 0

Expected behavior:
Streak freeze should automatically apply and preserve the streak.

Current behavior:
Streak resets to 0 despite having freezes available.
```

**Labels:** `bug`, `clarity-ai`

**Expected Behavior:**
- Should ask clarifying questions about:
  - Timezone handling for streak calculation
  - Auto-apply vs user confirmation for freezes
  - Current freeze logic location
- Should identify streak-related backend files

**Complexity:** Medium (Bug fix requiring understanding of existing logic)

---

## Test Case 3: Clear Feature Request (No Clarification Needed)

**Issue Title:** Add a share button for activity scores

**Issue Body:**
```
When I finish an activity and get a good score, I want to share it with friends.

Add a share button on the completion screen. When tapped, it should open the phone's native share menu. The shared message should say something like "I just scored 85% on [Activity Name]!" using the actual score and activity name.

Just text is fine, no need for images.
```

**Labels:** `enhancement`, `clarity-ai`

**Expected Behavior:**
- Should NOT ask clarifying questions -- requirements are clear
- Should find the activity completion screen
- Should use the platform's native share API
- Should construct message with dynamic score/activity name

**Complexity:** Low (Simple frontend feature)

---

## Test Case 4: Clear Bug Report (No Clarification Needed)

**Issue Title:** Audio restarts from beginning after phone call

**Issue Body:**
```
When listening to a lesson, if I get a phone call and come back, the audio starts over from the beginning instead of resuming where I left off.

This happens every time I get interrupted (phone calls, switching apps, etc). Please fix it so audio resumes from where it stopped.

Happens on both iOS and Android.
```

**Labels:** `bug`, `clarity-ai`

**Expected Behavior:**
- Should NOT ask clarifying questions -- bug is clearly described
- Should find audio playback code
- Should implement position saving before pause/background
- Should resume from saved position

**Complexity:** Medium (Bug fix in audio handling)

---

## Evaluation Criteria

### 1. Clarification Quality
- [ ] Identifies ambiguous requirements
- [ ] Asks specific, actionable questions
- [ ] Provides options/suggestions with questions
- [ ] Doesn't ask unnecessary questions for clear requirements

### 2. Codebase Understanding
- [ ] Correctly identifies relevant files
- [ ] Understands project structure
- [ ] Follows existing code patterns
- [ ] Uses correct imports and module structure

### 3. Implementation Quality
- [ ] Code compiles without errors
- [ ] Follows TypeScript best practices
- [ ] Matches existing code style
- [ ] Includes necessary DB migrations (if applicable)

### 4. PR Quality
- [ ] Clear commit messages
- [ ] Comprehensive PR description
- [ ] Links to the issue
- [ ] Reasonable scope (not over-engineered)

---

## Running the Evaluations

### Via GitHub Issues
```bash
# Create issues with clarity-ai label on your test repository
gh issue create \
  --repo YOUR_ORG/YOUR_REPO \
  --title "Allow users to set custom daily goals" \
  --body "Add a feature..." \
  --label "feature,clarity-ai"
```

### Via Slack Command
```
/clarity-feature Add daily goal setting for users
```

### Via Direct API
```bash
curl -X POST https://your-clarity-worker.workers.dev/webhooks/github \
  -H "Content-Type: application/json" \
  -d '{"action": "opened", "issue": {...}, "repository": {...}}'
```
