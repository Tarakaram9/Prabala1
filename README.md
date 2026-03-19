# 🔮 Prabala

**Prabala** is an open-source, keyword-driven test automation framework for **Web** and **Desktop** applications — the open-source answer to TOSCA, powered by Playwright.

---

## Features

- **Keyword-Driven** — Build tests from reusable action keywords, no code required
- **Web Automation** — Powered by [Playwright](https://playwright.dev): Chromium, Firefox, WebKit
- **Desktop Automation** — WinAppDriver (Windows), Appium Mac2 (macOS), AT-SPI (Linux) *(Phase 2)*
- **API Testing** — REST / GraphQL / SOAP keyword library
- **Object Repository** — Centralized, version-controlled locator store (YAML + SQLite)
- **Business Modules** — Compose reusable test modules from keywords
- **Test Data Management** — JSON / YAML / CSV data binding with `{TEST_DATA.key}` syntax
- **Rich HTML Reports** — Beautiful interactive test reports with screenshots
- **CI/CD Ready** — GitHub Actions, Jenkins, Azure DevOps
- **AI Self-Healing** — *(Phase 4)* Automatic locator healing when UI changes

---

## Quick Start

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Initialise a new project
npx prabala init

# Run tests
npx prabala run "tests/**/*.yaml"

# List all available keywords
npx prabala list-keywords
```

---

## Project Structure

```
prabala/
├── packages/
│   ├── core/               # Engine, parser, keyword registry, orchestrator
│   ├── driver-web/         # Playwright web keywords
│   ├── driver-desktop/     # WinAppDriver / Appium desktop keywords (Phase 2)
│   ├── driver-api/         # REST/GraphQL API keywords
│   ├── object-repository/  # SQLite-backed locator store
│   ├── reporting/          # HTML reporter
│   └── cli/                # prabala CLI
├── tests/                  # Your YAML test cases
├── object-repository/      # YAML locator definitions
├── test-data/              # JSON / YAML test data
└── prabala.config.yaml     # Project configuration
```

---

## Writing Tests

```yaml
# tests/login.yaml
testCase: "Login with valid credentials"
tags:
  - smoke
  - auth
steps:
  - keyword: Web.Launch

  - keyword: NavigateTo
    params:
      url: "{BASE_URL}/login"

  - keyword: EnterText
    params:
      locator: "@username-input"
      value: "{TEST_DATA.username}"

  - keyword: EnterText
    params:
      locator: "@password-input"
      value: "{TEST_DATA.password}"

  - keyword: Click
    params:
      locator: "@login-button"

  - keyword: AssertVisible
    params:
      locator: "@dashboard-header"

  - keyword: TakeScreenshot
    params:
      name: "login-success"

  - keyword: Web.Close
```

---

## Object Repository

```yaml
# object-repository/login-page.yaml
objects:
  username-input:
    strategy: css
    locator: "#username"
    description: "Username input field"

  password-input:
    strategy: css
    locator: "#password"

  login-button:
    strategy: text
    locator: "Log In"

  dashboard-header:
    strategy: aria
    locator: "Dashboard"
```

---

## Configuration (`prabala.config.yaml`)

```yaml
baseUrl: "https://your-app.com"
browser: chromium        # chromium | firefox | webkit
headless: true
timeout: 30000
objectRepositoryDir: object-repository
testDataDir: test-data
outputDir: artifacts
```

---

## Built-in Web Keywords

| Keyword | Description |
|---|---|
| `Web.Launch` | Open a new browser session |
| `Web.Close` | Close browser and save trace |
| `NavigateTo` | Navigate to a URL |
| `Click` | Click an element |
| `DoubleClick` | Double-click an element |
| `EnterText` | Type text into input |
| `PressKey` | Press a keyboard key |
| `SelectOption` | Select a dropdown option |
| `Hover` | Hover over element |
| `Check` / `Uncheck` | Checkbox interaction |
| `UploadFile` | Upload file to input |
| `WaitForVisible` | Wait for element to appear |
| `WaitForHidden` | Wait for element to disappear |
| `AssertVisible` | Assert element visible |
| `AssertText` | Assert element text |
| `AssertTitle` | Assert page title |
| `AssertUrl` | Assert current URL |
| `AssertValue` | Assert input value |
| `GetText` | Capture text to variable |
| `TakeScreenshot` | Save full-page screenshot |
| `AcceptAlert` | Accept browser dialog |
| `Wait` | Fixed delay (ms) |

---

## Roadmap

- [x] Phase 1 – Core engine, Playwright web driver, CLI, HTML reporting
- [ ] Phase 2 – Desktop driver (WinAppDriver, Appium Mac2, AT-SPI)
- [ ] Phase 3 – Visual Test Studio (Electron + React)
- [ ] Phase 4 – AI self-healing locators
- [ ] Phase 5 – Community keyword marketplace, SAP/Salesforce connectors

---

## License

Apache 2.0 — Free to use, fork, and contribute.
