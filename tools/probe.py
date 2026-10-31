import json,numpy as np,math
M=json.load(open(r'D:\StarFinderData\model\meta.json')); import os;G=np.load(os.path.join(r'D:\StarFinderData\model',os.environ.get('SF_OUTNAME','glow_raw.npy')))
def g(lat,lon):
    i=int((M['lat0']-lat)/M['deg']); j=int((lon-M['lon0'])/M['deg']); return float(G[i,j])
P=json.load(open('C:/Users/luxbo/Documents/Code/StarFinder/data/research/merged_checked.json',encoding='utf-8'))
pp={p['id']:p for p in P}
anch={'enchanted-rock':pp['tx-enchanted-rock'],'south-llano':pp['tx-south-llano-river']}
er=g(anch['enchanted-rock']['lat'],anch['enchanted-rock']['lon']); sl=g(anch['south-llano']['lat'],anch['south-llano']['lon'])
c=0.2/math.sqrt(er*sl)
def sqm(v): return 22.0-2.5*math.log10(1+c*v)
pts={'Enchanted Rock':(pp['tx-enchanted-rock']['lat'],pp['tx-enchanted-rock']['lon']),'South Llano':(pp['tx-south-llano-river']['lat'],pp['tx-south-llano-river']['lon']),
 'Big Bend Panther Jct':(29.3277,-103.2059),'Big Bend Ranch':(pp['tx-big-bend-ranch']['lat'],pp['tx-big-bend-ranch']['lon']),'Copper Breaks':(pp['tx-copper-breaks']['lat'],pp['tx-copper-breaks']['lon']),
 'McDonald Obs':(30.6797,-104.0247),'Austin downtown':(30.2672,-97.7431),'Dallas downtown':(32.7767,-96.797),'Houston downtown':(29.7604,-95.3698),'Manor TX':(30.3408,-97.5569),'Mineral Wells':(32.8085,-98.1128),'Austin suburb Round Rock':(30.5083,-97.6789),'Lockhart SP':(pp['tx-lockhart']['lat'],pp['tx-lockhart']['lon']),'Midland':(31.9973,-102.0779)}
print('c',c)
for k,(a,b) in pts.items():
    v=g(a,b); print(f'{k:26s} glow {v:10.2f} ratio {c*v:8.3f} SQM {sqm(v):6.2f}')
