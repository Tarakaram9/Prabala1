// ─────────────────────────────────────────────────────────────────────────────
// Custom Web Keywords – Example File
// Place .js keyword files in keywords/web/ or keywords/desktop/
// They are auto-loaded before every test run.
//
// Each keyword has:
//   name    – how you reference it in your YAML test case
//   execute – async function(params, context) that runs the step
//
// context.driverInstances['web'].page  → Playwright Page object
// context.variables                    → current variable store
// context.objectRepository             → locators from object-repository/
// ─────────────────────────────────────────────────────────────────────────────

module.exports = [

  /**
   * Keyword: LoginAs
   * Usage in YAML:
   *   - keyword: LoginAs
   *     params:
   *       username: admin
   *       password: secret
   */
  {
    name: 'LoginAs',
    description: 'Fill username + password fields and submit the login form',
    execute: async (params, context) => {
      const page = context.driverInstances['web']?.page;
      if (!page) throw new Error('No web session active. Add Web.Launch before LoginAs.');

      const { username, password, usernameLocator, passwordLocator, submitLocator } = params;

      // Defaults match common login forms – override via params if needed
      await page.fill(usernameLocator ?? '[name="username"], [placeholder*="user" i], #username', String(username));
      await page.fill(passwordLocator ?? '[type="password"]', String(password));
      await page.click(submitLocator ?? '[type="submit"], button:has-text("Login"), button:has-text("Sign In")');
      await page.waitForLoadState('networkidle');
    }
  },

  /**
   * Keyword: AssertElementCount
   * Usage in YAML:
   *   - keyword: AssertElementCount
   *     params:
   *       locator: 'li.todo-item'
   *       expected: '3'
   */
  {
    name: 'AssertElementCount',
    description: 'Assert the number of matching elements equals expected',
    execute: async (params, context) => {
      const page = context.driverInstances['web']?.page;
      if (!page) throw new Error('No web session active.');

      const count = await page.locator(String(params.locator)).count();
      const expected = parseInt(String(params.expected), 10);
      if (count !== expected) {
        throw new Error(`Expected ${expected} element(s) matching "${params.locator}" but found ${count}`);
      }
    }
  },

  /**
   * Keyword: SavePageTitle
   * Usage in YAML:
   *   - keyword: SavePageTitle
   *     params:
   *       variable: pageTitle
   *
   * Then use {{pageTitle}} in later steps.
   */
  {
    name: 'SavePageTitle',
    description: 'Save the current page title into a variable',
    execute: async (params, context) => {
      const page = context.driverInstances['web']?.page;
      if (!page) throw new Error('No web session active.');

      const title = await page.title();
      const varName = String(params.variable ?? 'pageTitle');
      context.variables[varName] = title;
      console.log(`    [SavePageTitle] ${varName} = "${title}"`);
    }
  },

  /**
   * Keyword: WaitForText
   * Usage in YAML:
   *   - keyword: WaitForText
   *     params:
   *       locator: '#status'
   *       text: 'Ready'
   *       timeout: '5000'
   */
  {
    name: 'WaitForText',
    description: 'Wait until an element contains the expected text',
    execute: async (params, context) => {
      const page = context.driverInstances['web']?.page;
      if (!page) throw new Error('No web session active.');

      const timeout = parseInt(String(params.timeout ?? '10000'), 10);
      await page.locator(String(params.locator)).filter({ hasText: String(params.text) }).waitFor({ timeout });
    }
  },

];
