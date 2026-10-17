# Uploading many questions at once

This guide is for the owner. You have a lot of questions (hundreds or thousands). Instead of typing each one in the app, you
let an AI chat (ChatGPT, Claude, Gemini, ...) turn them into one file, and then you load that file in the app.

## The 4 steps

1. **Collect your questions** (a document, a photo of a book, a spreadsheet - anything the AI chat can read).
2. **Ask the AI chat** to convert them. Copy the prompt below, paste it, then paste or attach your questions.
3. **Save the answer as a file** ending in `.json` (for example `physics-1.json`) and put it on your phone.
4. **In the app:** Create tab -> **Import many (file)** -> choose the file -> check the summary -> tick the box -> **Start import**.

Always try a small file first (10 questions) to see that everything works.

## The prompt to copy

> Convert my questions into this exact JSON template, one item per question, no extra text. Return only the JSON. Split the
> result into files of at most 500 items (tell me when there is a "next part"). Do not change the meaning of any question.
> If a question has no explanation, write a short, correct one. Keep each question in its own language (Hindi stays Hindi,
> English stays English).
>
> Template:
>
> ```json
> {
>   "version": 1,
>   "language": "hi",
>   "topic": "the subject or chapter these questions teach (2-80 characters)",
>   "items": [
>     {
>       "q": "Question text",
>       "options": ["Option A text", "Option B text", "Option C text", "Option D text"],
>       "answer": "B",
>       "explanation": "Why B is correct (required)",
>       "difficulty": "easy"
>     }
>   ]
> }
> ```
>
> Rules:
>
> - `language` is `"hi"` or `"en"`. It is the default for every item. An item may have its own `"language"`.
> - `topic` is the default topic. An item may have its own `"topic"` (2-80 characters, any words).
> - `answer` is the letter of the right option (`"A"`, `"B"`, ...), or the exact text of the right option, or its number
>   (1 = first option).
> - `options` has 2 to 8 entries. Do not put "A)" or "1." in front of the option text.
> - `difficulty` is `"easy"`, `"medium"` or `"hard"` (optional, default `"medium"`).
> - `explanation` is required for every question.
> - Use plain text only: no HTML, no images.
> - Output valid JSON: double quotes, no trailing commas, no comments.

The file `content/bulk-template.json` in the project is a longer example. It also shows the other kinds of items below.

## Other kinds of items (optional)

The short form above is only for multiple-choice questions. For everything else the AI chat can use the full form. Each item
needs `kind`, `title` (3 or more characters) and `body`:

| What              | `kind`      | `body`                                                                                 | Also needs                                          |
| ----------------- | ----------- | -------------------------------------------------------------------------------------- | --------------------------------------------------- |
| True / false      | `question`  | `{ "type": "true_false", "prompt": "..." }`                                            | `"answer": { "value": true }` and `explanation`     |
| Fill in the blank | `question`  | `{ "type": "fill_blank", "prompt": "... ______ ..." }`                                 | `"answer": { "accepted": ["x", "y"] }`, explanation |
| Number answer     | `question`  | `{ "type": "numerical", "prompt": "..." }`                                             | `"answer": { "value": 4.5, "tolerance": 0 }`, expl. |
| Multiple choice   | `question`  | `{ "type": "single_choice", "prompt": "...", "options": [{ "id": "a", "text": "" }] }` | `"answer": { "optionId": "a" }`, explanation        |
| Flashcard         | `flashcard` | `{ "front": "...", "back": "..." }`                                                    | nothing else                                        |
| Short note        | `note`      | `{ "blocks": [{ "type": "paragraph", "text": "..." }] }`                               | nothing else                                        |

Note blocks can be `heading` (with `level` 1-4 and `text`), `paragraph`, `list` (with `items`), `callout` (with
`kind`: tip, warning, misconception or example), `formula` (with `latex`) and `revision_prompt` (with `prompt`).

Videos and image posts cannot be imported from a file. Make those in the app with **New post**.

## What the app does when you load a file

- It reads the file and checks **every** item on your phone. Nothing is uploaded yet.
- It shows "N ready to import, M with problems" and the first 5 problems (item number and what is wrong).
- Items with problems are skipped. The good ones are still imported.
- You tick the box that says you wrote the content or have the right to share it. Only share what you own or may share.
- **Start import** sends the posts in small groups of 25 and shows a progress bar. You can press **Cancel import** at any time.
- Posts go live right away (there is no approval step).
- At the end you see how many were imported and how many failed, with the first few reasons.

Keep the app open while it runs. A file of 500 questions takes a few minutes.

## Limits

- At most **5000 items** and **5 MB** per file. Ask the AI chat for files of about 500 items - they are easier to check.
- Trusted creators can import about **1000 posts per hour**. Other accounts can post about **20 per hour**.
- If you hit the limit, the app stops and tells you "start again from item N". Wait a while, then import the same file again
  and type N in **Start from item number**, so nothing is imported twice.
- Importing the same file twice creates the posts twice. Use **Start from item number** to continue instead.

## Common problems

| What you see                                                        | What to do                                                                                     |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| "This is not valid JSON"                                            | The AI chat added extra words, or left out a quote or comma. Ask it: "Return only valid JSON." |
| "No items list was found"                                           | The file must contain `"items": [ ... ]`. Ask the AI chat to follow the template exactly.      |
| "Item 12: answer ... does not match any option"                     | The answer is not one of the options. Fix that item, or ask the AI chat to correct it.         |
| "Item 7: topic is missing"                                          | Add `"topic"` at the top of the file or on the item.                                           |
| "Item 3: language is missing"                                       | Add `"language": "hi"` (or `"en"`) at the top of the file or on the item.                      |
| "the question is not valid (check options, answer and explanation)" | The explanation is empty, an option is empty, or there are fewer than 2 options.               |
| "The file is bigger than 5 MB" / "more than 5000 items"             | Split it into smaller files.                                                                   |
| "You reached your posting limit"                                    | Wait, then continue from the item number shown.                                                |
| "The connection was lost"                                           | Reconnect and continue from the item number shown. The app already retried twice by itself.    |
| "The server refused the import"                                     | Your account may not be allowed to post right now. Sign in again, or contact support.          |

## Good habits

- Check a few imported questions in the app (Create tab -> My posts) before importing the other files.
- Do not copy questions from books or websites unless you have the right to. Access to a text does not mean you may reuse it.
- Keep your original files. If something is wrong, you can ask the AI chat to fix it and import only the corrected part.
