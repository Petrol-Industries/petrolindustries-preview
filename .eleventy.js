const yaml = require("js-yaml");

const buildId = process.env.GITHUB_SHA ? process.env.GITHUB_SHA.slice(0, 8) : String(Date.now());

module.exports = function (eleventyConfig) {
  eleventyConfig.addDataExtension("yaml", (contents) => yaml.load(contents));
  eleventyConfig.addFilter("v", (url) => {
    if (!url) return url;
    if (/^https?:\/\//i.test(url)) return url;
    return url + (url.includes("?") ? "&" : "?") + "v=" + buildId;
  });
  eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });
  eleventyConfig.addPassthroughCopy({ "src/robots.txt": "robots.txt" });
  eleventyConfig.addPassthroughCopy({ "src/CNAME": "CNAME" });
  eleventyConfig.addPassthroughCopy({ "admin": "admin" });

  return {
    dir: {
      input: "src",
      includes: "_includes",
      data: "_data",
      output: "_site",
    },
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk",
  };
};
