# Filler

A Manifest V3 Chrome extension that fills job applications from unstructured notes and summarizes the posting. You bring your own API key for OpenAI, Anthropic, Gemini, or Grok.

The key is read only by the background service worker. Content scripts never receive it, and the extension does not print it to the console.

## Install

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Choose **Load unpacked** and select this folder.
4. Pin Filler. On a first install, the options page opens.

Chrome will ask for access to the model APIs. The first time you click **Fill form** or **Summarize page**, it also asks for permission to read the sites you use. That permission is what lets a multi-step application keep working after the page changes.

## Set it up

On the options page:

- Choose a provider and paste your API key.
- Leave the model blank to use the default, or paste a model id your account can call.
- Set **API base URL** only for an OpenAI-compatible proxy. Use https, or http on localhost.
- Paste your background in any format: contact details, work history, work authorization, location, and how you want short answers written.
- Save, then **Test key**.

`chrome.storage.local` keeps the key on this device. It is not synced, and it is not encrypted beyond the browser profile. Use a profile you trust.

## Use it

Open an application, then open Filler.

- **Fill form** reads the current page, asks the model for answers, and writes them in.
- **Summarize page** reads the main text and shows a short summary in the popup. If you saved a background, the summary can include a few fit notes.
- **Advance through Next** clicks a button named Next, Continue, or Save and Continue, waits for the next step, and fills again. It will not click Submit or Apply.
- Keep the popup open while a request is running. Closing it does not cancel the fill; **Cancel** does.
- Resume and cover-letter uploads stay manual. Browsers do not let an extension set a file input.

The included demo is `demo/application.html`. From this folder:

```bash
python3 -m http.server 8765
```

Open `http://localhost:8765/demo/application.html`. The page logs `input`, `change`, and `blur`, which is how you can see that a framework-style field accepted the value.

## How a fill works

1. The popup asks for site access, then tells the service worker which tab to fill.
2. The worker injects the scanner into each frame that has controls, including shadow roots.
3. The scanner records labels, placeholders, ARIA names, nearby headings, help text, and options. It understands native inputs plus the custom widgets used by Workday (`data-automation-id`, `aria-haspopup="listbox"`), Greenhouse and React Select (`.select__control`), and Lever (`.application-question`).
4. The worker sends your notes and that schema to the provider. The system prompt requires JSON shaped as `{"fills":[{"fieldId":"...","value":"..."}]}`. A bare array of the same objects is accepted too.
5. Values are written in the page world. Text uses the native value setter, resets React’s `_valueTracker` when it exists, and dispatches `input`, `change`, and `blur` with `composed: true` so the events cross shadow DOM. Custom dropdowns are opened, given a short moment to render, and then the matching option is clicked.
6. Fields that fail to match an option are left alone and listed in the popup.

Field labels and page text are treated as untrusted. The prompt tells the model not to follow instructions found in them, and the filler only assigns values. It never evaluates the model’s response as code.

## Limits

- File inputs cannot be filled.
- Password, payment, and hidden honeypot fields are skipped.
- Closed shadow roots are invisible to every extension.
- Events created by an extension are not trusted user input. Some applicant systems ignore them. If a value appears and then vanishes, click that field and run Fill again.
- Only the first 70 fields on a step are sent. Run Fill again for the rest.
- Auto-advance stops after the step limit (1–6) or when it cannot find a Next button.

## Layout

```
manifest.json
background/    service worker, provider calls, prompts
content/       DOM helpers, form scanner, filler
popup/         Fill and Summarize
options/       key, model, and background
shared/        provider defaults
demo/          local application page
tests/         scanner, matcher, and prompt tests
```

## Development

```bash
npm install
npm test
```

`npm test` checks syntax and runs the scanner against a jsdom page, including a custom listbox, a hidden select paired with a visible combobox, React’s value tracker, and the rule that Submit is not clicked.
