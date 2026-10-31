import json, html
rows=[]
skip={'barton-warnock','indian-lodge','wyler-aerial-tramway'}
for line in open('web/tpwd_list.txt',encoding='utf-8'):
    slug,name=line.strip().split('|',1)
    if slug in skip: continue
    name=html.unescape(name)
    rows.append({'id':'tx-'+slug,'name_hint':name,'agency_hint':'Texas Parks and Wildlife Department','url_hint':'https://tpwd.texas.gov/state-parks/'+slug})
nps=[('alfl','Alibates Flint Quarries National Monument'),('amis','Amistad National Recreation Area'),('bibe','Big Bend National Park'),('bith','Big Thicket National Preserve'),('blsc','Blackwell School National Historic Site'),('cham','Chamizal National Memorial'),('foda','Fort Davis National Historic Site'),('gumo','Guadalupe Mountains National Park'),('lamr','Lake Meredith National Recreation Area'),('lyjo','Lyndon B. Johnson National Historical Park'),('pais','Padre Island National Seashore'),('paal','Palo Alto Battlefield National Historical Park'),('rigr','Rio Grande Wild and Scenic River'),('saan','San Antonio Missions National Historical Park'),('waco','Waco Mammoth National Monument')]
for c,n in nps:
    rows.append({'id':'nps-'+c,'name_hint':n,'agency_hint':'National Park Service','url_hint':'https://www.nps.gov/'+c+'/'})
fs=['Angelina National Forest','Davy Crockett National Forest','Sabine National Forest','Sam Houston National Forest','Caddo National Grassland','Lyndon B. Johnson National Grassland','McClellan Creek National Grassland','Rita Blanca National Grassland','Black Kettle National Grassland (Lake Marvin, Texas unit)']
for n in fs:
    slug=n.lower().split(' (')[0].replace('.','').replace(' ','-')
    rows.append({'id':'usfs-'+slug,'name_hint':n,'agency_hint':'USDA Forest Service','url_hint':'https://www.fs.usda.gov/ (find the official page)'})
print(len(rows))
n=12
batches=[rows[i::n] for i in range(n)]  # interleaved so every batch mixes agencies
for i,b in enumerate(batches,1):
    json.dump(b,open(f'/c/Users/luxbo/Documents/Code/StarFinder/data/research/assign_{i:02d}.json'.replace('/c/','C:/'),'w',encoding='utf-8'),indent=1)
    print(i,len(b),[r['id'] for r in b][:3])
json.dump(rows,open('C:/Users/luxbo/Documents/Code/StarFinder/data/research/master_list.json','w',encoding='utf-8'),indent=1)
