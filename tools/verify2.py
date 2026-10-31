import json,math,urllib.request,urllib.parse
D='C:/Users/luxbo/Documents/Code/StarFinder/data/research/'
P=json.load(open(D+'merged_checked.json',encoding='utf-8'))
UA={'User-Agent':'StarFinder-verify/1.0 (research for a free public map; github rose-bot47/StarFinder)'}
def km(a,b,c,d):
    p=math.radians;dl=p(c-a);dn=p(d-b)
    h=math.sin(dl/2)**2+math.cos(p(a))*math.cos(p(c))*math.sin(dn/2)**2
    return 2*6371*math.asin(math.sqrt(h))
rest=[p for p in P if not p['id'].startswith('tx-')]
titles={p['id']:p['name'].replace(' (Lake Marvin, Texas unit)','') for p in rest}
fix={'nps-rigr':'Rio Grande Wild and Scenic River','usfs-black-kettle-national-grassland':'Black Kettle National Grassland'}
titles.update(fix)
q=urllib.parse.urlencode({'action':'query','prop':'coordinates','titles':'|'.join(titles.values()),'format':'json','redirects':1,'colimit':'max'})
j=json.loads(urllib.request.urlopen(urllib.request.Request('https://en.wikipedia.org/w/api.php?'+q,headers=UA),timeout=30).read())
red={r['from']:r['to'] for r in j['query'].get('redirects',[])}
co={}
for pg in j['query']['pages'].values():
    if 'coordinates' in pg: co[pg['title']]=(pg['coordinates'][0]['lat'],pg['coordinates'][0]['lon'])
for p in rest:
    t=red.get(titles[p['id']],titles[p['id']]); c=co.get(t)
    d=round(km(p['lat'],p['lon'],*c),1) if c else None
    p['_wiki_check']=[c[0],c[1],d] if c else None
    print(f"{p['id']:45s} {d!s:>7} km  {p['coord_point'][:60]}")
json.dump(P,open(D+'merged_checked.json','w',encoding='utf-8'),indent=1,ensure_ascii=False)
