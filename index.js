const express = require("express");
const { chromium } = require("playwright");
const fetch = require("node-fetch");
const cheerio = require("cheerio");

const app = express();
app.use(express.json());

app.post("/api/login/onetsp", async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }

  console.log("Starting login to onetsp.com...");
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto("https://onetsp.com/account/signin");
    console.log("Navigated to login page.");

    // Fill in login form (selectors may need adjustment)
    await page.fill('input[name="email"]', username);
    await page.fill('input[name="password"]', password);
    await page.click('input[type="submit"]');
    await page.waitForLoadState("networkidle");
    console.log("Login submitted and page loaded.");

    // Check if login was successful by looking for error messages or redirects
    const currentUrl = page.url();
    const pageContent = await page.content();

    // Check for common login error indicators
    if (
      currentUrl.includes("/account/signin") ||
      pageContent.includes("Incorrect email address or password.")
    ) {
      console.error("Login failed - invalid credentials");
      return res.status(401).json({
        error: "Login failed",
        message: "Invalid email or password",
      });
    }

    // Check if we're still on the login page (login didn't work)
    if (currentUrl.includes("/account/signin")) {
      console.error("Login failed - still on login page");
      return res.status(401).json({
        error: "Login failed",
        message: "Unable to authenticate with provided credentials",
      });
    }

    await page.goto("https://onetsp.com/recipes/recent/1");

    // Get session cookie after login
    const cookies = await page.context().cookies();
    const sCookie = cookies.find((c) => c.name === "s");
    if (!sCookie) {
      console.error("Session cookie not found after login");
      return res.status(401).json({
        error: "Authentication failed",
        message: "Session cookie not found after login",
      });
    }
    const sValue = sCookie.value;
    return res.status(200).json({ token: sValue });
  } catch (error) {
    console.error("Failed to login");
    res.status(500).json({ error: error.message });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

app.post("/api/import/onetsp", async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ error: "token required" });
    }

    // Use fetch and cheerio to collect all recipe URLs from paginated pages
    let pageNum = 1;
    let allUrls = [];
    let hasNext = true;
    while (hasNext) {
      const pageUrl = `https://onetsp.com/recipes/recent/${pageNum}`;
      console.log(`Fetching recipe list page: ${pageUrl}`);
      const resp = await fetch(pageUrl, {
        headers: {
          Cookie: `s=${token}`,
        },
      });
      const buffer = await resp.buffer();
      const html = buffer.toString("utf8");
      const $ = cheerio.load(html);
      // Extract URLs from div.rows > ul > li > a
      const urls = [];
      $("div.row ul li a").each((i, el) => {
        urls.push(
          $(el).attr("href").startsWith("http")
            ? $(el).attr("href")
            : `https://onetsp.com${$(el).attr("href")}`
        );
      });
      console.log(`Found ${urls.length} recipe URLs on page ${pageNum}.`);
      allUrls = allUrls.concat(urls);
      // Check for 'Next' link in div.pagination > ul > li > a
      hasNext = false;
      $("div.pagination ul li a").each((i, el) => {
        if ($(el).text().trim().startsWith("Next")) {
          hasNext = true;
        }
      });
      pageNum++;
    }
    console.log(`Total recipe URLs collected: ${allUrls.length}`);

    // Visit each recipe URL and extract data using fetch and cheerio
    const recipes = [];
    for (const url of allUrls) {
      console.log(`Fetching recipe: ${url}`);
      const resp = await fetch(url, {
        headers: {
          Cookie: `s=${token}`,
        },
      });
      const buffer = await resp.buffer();
      const html = buffer.toString("utf8");
      const $ = cheerio.load(html);
      // Extract title
      const title = $("div.page-header h1").text().trim() || null;
      // Extract ingredients
      const ingredients = [];
      $("#ingredients ul.ingredients li.ingredient").each((i, el) => {
        ingredients.push($(el).text().trim());
      });
      // Extract instructions
      const instructions = [];
      $("#instructions ol.method li.step").each((i, el) => {
        instructions.push($(el).text().trim());
      });
      // Extract recipeUrl if present (link-out recipe)
      let recipeUrl = null;
      // Try <a rel="cite">
      const citeLink = $('a[rel="cite"]').attr("href");
      if (citeLink) {
        recipeUrl = citeLink;
      } else {
        // Try <a> with text 'View recipe'
        $("a").each((i, el) => {
          if ($(el).text().trim() === "View recipe") {
            recipeUrl = $(el).attr("href");
          }
        });
      }
      // Extract tags
      const tags = [];
      $("#tagsList li a.tagname").each((i, el) => {
        tags.push($(el).text().trim());
      });

      // Extract cooktime (total time)
      let cooktime = null;
      $("#times div").each((i, el) => {
        const label = $(el).find(".label").text().trim();
        if (label === "Total") {
          cooktime = $(el).text().replace("Total", "").trim();
        }
      });

      recipes.push({
        url,
        title,
        ingredients,
        instructions,
        recipeUrl,
        tags,
        cooktime,
      });
    }
    console.log(
      `Finished fetching all recipes. Returning ${recipes.length} recipes.`
    );
    res.json({ recipes });
  } catch (error) {
    console.error("Error in /api/import/onetsp:", error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
