import json,re,math,random,urllib.request,urllib.parse,time
D='C:/Users/luxbo/Documents/Code/StarFinder/data/research/'
P=json.load(open(D+'merged_raw.json',encoding='utf-8'))
UA={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 StarFinder-verify (StarFinder research; contact via github luxbot01)'}
def get(u):
    return urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=30).read().decode('utf-8','replace')
def km(a,b,c,d):
    R=6371;p=math.radians;dl=p(c-a);dn=p(d-b)
    h=math.sin(dl/2)**2+math.cos(p(a))*math.cos(p(c))*math.sin(dn/2)**2
    return 2*R*math.asin(math.sqrt(h))
# 1) every TPWD place: re-read the printed point myself (map link lat=..&lon=..)
out=[]
for p in P:
    if not p['id'].startswith('tx-'): continue
    try:
        h=get(p['url'] or ('https://tpwd.texas.gov/state-parks/'+p['id'][3:]))
        m=re.search(r'Latitude:\s*(-?\d+\.\d+)\s*</p>\s*<p>Longitude:\s*(-?\d+\.\d+)',h)
        if m:
            la,lo=float(m.group(1)),float(m.group(2)); d=km(p['lat'],p['lon'],la,lo)
            out.append((p['id'],round(d,2))); p['_tpwd_check']=[la,lo,round(d,3)]
        else: out.append((p['id'],'no point printed'))
    except Exception as e: out.append((p['id'],'ERR '+str(e)[:60]))
    time.sleep(0.4)
far=[o for o in out if not isinstance(o[1],float) or o[1]>0.5]
print('TPWD rechecked',len(out),'within 0.5 km',len(out)-len(far)); print('flags',far)
json.dump(P,open(D+'merged_checked.json','w',encoding='utf-8'),indent=1,ensure_ascii=False)
