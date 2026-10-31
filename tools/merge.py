import json,glob,math
D='C:/Users/luxbo/Documents/Code/StarFinder/data/research/'
master=json.load(open(D+'master_list.json',encoding='utf-8'))
places=[];authors={}
for f in sorted(glob.glob(D+'batch_*.json')):
    j=json.load(open(f,encoding='utf-8'))
    authors[f[-7:-5]]=j.get('_author')
    for p in j['places']: p['_batch']=f[-7:-5]; places.append(p)
ids=[p['id'] for p in places]
print('places',len(places),'unique',len(set(ids)),'missing',set(r['id'] for r in master)-set(ids))
print('authors',authors)
bad=[(p['id'],p['lat'],p['lon']) for p in places if not (isinstance(p['lat'],(int,float)) and 25.8<=p['lat']<=36.6 and -106.7<=p['lon']<=-93.4)]
print('out of bounds',bad)
src={'tpwd':0,'nps':0,'fs':0,'wiki':0,'other':0}
for p in places:
    s=(p.get('coord_source') or '').lower()
    k='tpwd' if 'tpwd' in s else 'nps' if 'nps.gov' in s else 'fs' if 'fs.usda' in s else 'wiki' if 'wikipedia' in s else 'other'
    src[k]+=1
print('coord sources',src)
print('camping true',sum(1 for p in places if p['camping'] is True),'false',sum(1 for p in places if p['camping'] is False),'null',sum(1 for p in places if p['camping'] is None))
print('dark_sky',[(p['id'],p['dark_sky'].get('designation') if p['dark_sky'] else None) for p in places if p['dark_sky']])
print('types',sorted(set(p['type'] for p in places)))
json.dump(places,open(D+'merged_raw.json','w',encoding='utf-8'),indent=1,ensure_ascii=False)
