var	Crawler = require('../index.js'),
    Logger = require('bunyan');


logger = new Logger({
  name: 'spiderjs',
  stream: process.stdout,
  level: "info"
});

crawler = new Crawler({log: this.logger});
crawler.crawl(['http://google.com'], {
    log: logger.child({sid: 1})
}).then(function(result){
  console.log('Crawl result:', JSON.stringify(result, null, 4))
}).otherwise(function(error){
  console.log("Failed to crawl:", error);
});
