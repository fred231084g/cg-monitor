const fs = require("fs");
const util = require("util");

const target = "./report.json";

const aggregatedData = [];

const lastTwelveMonths = (() => {
  const now = new Date();
  const ayearago = new Date();
  const months = [];
  ayearago.setDate(1);
  ayearago.setMonth(ayearago.getMonth() - 11);
  while (ayearago < now) {
    months.push(ayearago.toJSON().slice(0,7));
    ayearago.setMonth(ayearago.getMonth() + 1);
  }
  return months;
})();

const shortType = {
  'business group': 'bg',
  'community group': 'cg',
  'interest group': 'ig',
  'working group': 'wg'
};

const loadDir = async dirPath => {
  const files = await util.promisify(fs.readdir)(dirPath);
  return util.promisify(fs.readFile)(dirPath + '/staff.json', 'utf-8')
    .then(JSON.parse)
    .then(staff => Promise.all(
      files.filter(path => path.match(/\.json$/)).filter(path => path !== 'staff.json')
        .map(
          path => util.promisify(fs.readFile)(dirPath + "/" + path, 'utf-8')
            .then(JSON.parse)
            .catch(err => { console.error("Failed parsing " + path + ": " + err);})
            .then(data => {
              const cgData = {};
              const staffids = Array.isArray(staff) ? staff.map(s => s._links.self.href) : [];
              cgData.id = data[0].id;
              cgData.name = data[0].name;
              cgData.type = shortType[data[0].type];
              cgData.link = data[0]._links.homepage.href;
              // Approximating creation date to date of first person joining
              cgData.created = new Date((data[3][0] || {}).created + "Z");
              cgData.participants = data[4].length;
              cgData.chairs = data[2].filter(x => x).map(c => c.title);
              cgData.staff = data[4].filter(u => u._links.user && staffids.includes(u._links.user.href)).map(u => { const team = staff.find(s => s._links.self.href === u._links.user.href); return { name: team.name, photo: (team._links.photos ? team._links.photos.find(p => p.name === "tiny").href : undefined) } ;});

              cgData.repositories = [];
              cgData.activity = {};
              if (data[1] && data[1].length) {
                data[1].forEach(({items}) => {
                  cgData.repositories = cgData.repositories.concat(items.map(i => (i.html_url || '').split('/').slice(0,5).join('/')));
                });
              }

              if (data[3] && data[3].length) {
                // treat forums as mailing lists
                data[3].forEach(({service}) => {
                  if (service.type === "forum") service.type = "lists";
                  cgData.repositories = cgData.repositories.concat(
                    ...data[3].filter(({service}) => service.type === "repository")
                      .map(({data}) => {
                        if (!data.items) return [];
                        return data.items.map(i => (i.html_url || '').split('/').slice(0,5).join('/'))})
                  ).concat(data[3].filter(({service}) => service.type === "repository").map(({service}) => service.link));
                });
                cgData.repositories = [...new Set(cgData.repositories)];
                // aggregate by service type
                data[3].forEach(({service, data}) => {
                  let perMonthData;
                  if (data && data.items) {
                    perMonthData = lastTwelveMonths
                      .reduce((acc, m) => {
                        acc[m] = data.items.filter(i => (i.isoDate && i.isoDate.startsWith(m)) || (i.created_at && i.created_at.startsWith(m)) || (i.commit && i.commit.committer && i.commit.committer.date && i.commit.committer.date.startsWith(m)) ).length;
                        return acc;
                      }, {});
                  } else if (data && typeof data === "object") {
                    perMonthData = data;
                  } else {
                    // console.error("Missing data for " + service.type + " of " + cgData.name);
                  }
                  if (!perMonthData) return;
                  if (cgData.activity[service.type]) {
                    cgData.activity[service.type] = Object.keys(perMonthData).reduce((acc, m) => {
                      acc[m] += perMonthData[m];
                      return acc;
                    }, cgData.activity[service.type]);
                  } else {
                    cgData.activity[service.type] = perMonthData;
                  }
                });
              }

              cgData.activity['join'] = lastTwelveMonths
                .reduce((acc, m) => {
                  acc[m] = data[3].filter(j => j.created.startsWith(m)).length;
                  return acc;
                }, {});
              return cgData;
            }).catch(e => console.error("Error while dealing with " + path + ":" + e.toString()))
        ))
         );
};

loadDir("./data").then(data => {
  fs.writeFileSync('./report.json', JSON.stringify({timestamp: new Date(), data}, null, 2));
});
