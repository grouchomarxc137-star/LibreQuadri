#!/usr/bin/env python3
"""Development-only TiQuadri engineering-vocabulary proposal (Rev 8.4 Stages C–E)
from a fully imported Stage B baseline lq.db.

Stage C: protection/switching categories and article-true facts. Stage D: every
remaining Apparecchi model, classified by the function of its selected primary.
Stage E: MCCB trip-unit type from the pack name, corroborated by METEL text.

The committed JSON is reviewed reference data. This command never writes the
catalogue or the committed seed unless its output path is explicitly provided.
"""
import argparse
import collections
import json
import re
import sqlite3
from pathlib import Path

MODULAR_TYPES = {
    'Magnetotermici', 'Magnetotermici differenziali', 'Differenziali monoblocco',
    'Differenziali puri', 'Sezionatori', 'Solo Magnetici', 'Portafusibili',
    'Relè differenziale / Toroide', 'Salvamotori', 'Limitatori di Sovratensione',
    'Protezione',
}
GROUPS = {'Interruttori scatolati', 'Sezionatori con maniglia', 'Dispositivi modulari'}
SPECIAL = {'tq.pack.14744': 'protezione.portafusibili',
           'tq.pack.14745': 'protezione.portafusibili',
           'tq.pack.14746': 'protezione.portafusibili',
           'tq.pack.14747': 'protezione.fusibili'}
TYPE_VALUES = {'Tipo "AC"': 'ac', 'Tipo "A"': 'a', 'Tipo "A" - HPI': 'a',
               'Tipo "AS"': 'a', 'Tipo "AH"': 'a', 'Tipo "F"': 'f',
               'Tipo "F con contatore energia"': 'f',
               'Tipo "F con centrale misura"': 'f'}

# Stage D: the remaining project Apparecchi groups and modular Tipologie.
D_GROUPS = {'Automazione', 'Contattori non modulari', 'Dispositivi a pannello', 'Fusibili',
            'Prese industriali', 'Supervisione impianto', 'Trasformatori non modulari'}
D_MODULAR = {
    'Contattori': 'comando.contattori_rele', 'Relè': 'comando.contattori_rele',
    'Interruttori Orari Legrand': 'comando.interruttori_orari_temporizzatori',
    'Temporizzatori luce scale': 'comando.interruttori_orari_temporizzatori',
    'Crepuscolare': 'comando.interruttori_orari_temporizzatori',
    'Deviatori/Commutatori/Pulsanti': 'comando.apparecchi_di_comando',
    'Gestione carichi': 'comando.apparecchi_di_comando',
    'Spie Suonerie e Ronzatori': 'comando.segnalazione',
    'Alimentatori': 'alimentazione.alimentatori_trasformatori',
    'Trasformatori': 'alimentazione.alimentatori_trasformatori',
    'Contatori': 'misura.contatori_energia',
    'Strumenti multifunzione': 'misura.strumenti_di_misura',
    'Amperometri +TA': 'misura.strumenti_di_misura', 'Voltmetri': 'misura.strumenti_di_misura',
    'Commutatori': 'misura.strumenti_di_misura',
    'Accessori': 'accessori.accessori_quadro',
    'Moduli emergenza/ritardatori': 'accessori.accessori_quadro',
}
# Primaries reached from both Dispositivi modulari and Supervisione impianto get one
# category by function, whichever group reaches them (Gate 0 D8–D10).
ARTICLE_FUNCTION = {
    **{code: 'misura.contatori_energia' for code in (
        'BTI:F21DM63N', 'BTI:F41DM63N', 'BTI:F41DM125',  # "cont energ … MID", "COMPTEUR 125A-MID"
        'IMS:CE4DF3MTCL1', 'IMS:CE2DF3DTMID', 'IMS:CE6DMID56')},  # IME CONTATORI families
    'BTI:F4N200': 'misura.strumenti_di_misura',  # "centrale misura din rs485"
    'IMS:MFD4421': 'misura.strumenti_di_misura',  # IME MULTIFUNZIONE, Nemo D4-Le
    'BTI:F4CON12': 'supervisione.supervisione_impianto',  # pulse concentrator, not a meter
    'IMS:IF4C001': 'supervisione.supervisione_impianto',  # IME INTERFACCE E SOFTWARE
}
D_GROUP_CATEGORY = {
    'Automazione': 'automazione.sistemi_edificio',
    'Dispositivi a pannello': 'misura.strumenti_di_misura',
    'Fusibili': 'protezione.fusibili',
    'Prese industriali': 'prese.prese_industriali',
    'Supervisione impianto': 'supervisione.supervisione_impianto',
    'Trasformatori non modulari': 'alimentazione.alimentatori_trasformatori',
}
# Stage D exclusions: every option value used only by Stage D models needs an explicit
# reviewed meaning; an unknown dimension stops generation instead of defaulting.
ACCESSORY = 'Accessory, execution or wiring choice; not an electrical rating of the device'
ASSEMBLY = 'Selects another component of the assembly; its rating is not this device\'s'
NO_ATTRIBUTE = 'Electrical value without an approved Rev 8.4 attribute; not stored'
D_REASONS = {
    'tq.label.658': ACCESSORY, 'tq.label.954': ACCESSORY, 'tq.label.57': ACCESSORY,
    'tq.label.951': ACCESSORY, 'tq.label.952': ACCESSORY, 'tq.label.85': ACCESSORY,
    'tq.label.87': ACCESSORY, 'tq.label.131': ACCESSORY, 'tq.label.133': ACCESSORY,
    'tq.label.86': ACCESSORY, 'tq.label.74': ACCESSORY, 'tq.label.165': ACCESSORY,
    'tq.label.10': ACCESSORY, 'tq.label.97': ACCESSORY, 'tq.label.177': ACCESSORY,
    'tq.label.178': ACCESSORY, 'tq.label.179': ACCESSORY, 'tq.label.132': ACCESSORY,
    **{f'tq.label.{n}': ACCESSORY for n in range(700, 706)},
    'tq.label.77': 'Current-transformer primary rating of the assembly; not In of the instrument',
    'tq.label.200': ASSEMBLY, 'tq.label.81': NO_ATTRIBUTE,
    'tq.label.950': 'Motor-protection setting range; not nominal current In',
    'tq.label.953': 'Contactor rated operational current; not nominal current In',
    'tq.label.75': NO_ATTRIBUTE, 'tq.label.73': NO_ATTRIBUTE, 'tq.label.79': NO_ATTRIBUTE,
    'tq.label.71': NO_ATTRIBUTE, 'tq.label.300': NO_ATTRIBUTE, 'tq.label.170': NO_ATTRIBUTE,
    'tq.label.69': NO_ATTRIBUTE,
}
# Stage E: trip-unit type only for moulded-case/air breakers, from explicit pack-name
# evidence. ACB "Mgt" names a breaker (versus "Sez") and gives no trip-unit evidence.
TRIP_UNIT_CATEGORIES = {'protezione.interruttori_scatolati',
                        'protezione.interruttori_scatolati_differenziali',
                        'protezione.interruttori_aperti'}
THERMOMAGNETIC_TEXT = re.compile(r'magnetot|megnetot|\btm\b|\bmt\b', re.I)


def catalogue(conn):
    conn.row_factory = sqlite3.Row
    nodes = {r['id']: r for r in conn.execute('select id,parent_id,name,source_level from cat_range_node')}
    def ancestors(node_id):
        result = []
        while node_id in nodes:
            n = nodes[node_id]; result.append(n); node_id = n['parent_id']
        return result
    model_nodes = collections.defaultdict(list)
    for r in conn.execute('select model_id,node_id from cat_range_node_model'):
        model_nodes[r['model_id']].append(ancestors(r['node_id']))
    selected = {}
    for m in conn.execute("select id,code,name,model_kind,active,obsolete from cat_config_model where code like 'tq.pack.%'"):
        if not m['active'] or m['obsolete'] or m['model_kind'] != 'device':
            continue
        contexts = set()
        for chain in model_nodes[m['id']]:
            group = next((n['name'] for n in chain if n['source_level'] == 'lq_group'), None)
            typology = next((n['name'] for n in chain if n['source_level'] == 'g2'), None)
            if group in GROUPS and (group != 'Dispositivi modulari' or typology in MODULAR_TYPES):
                contexts.add((group, typology, 'C'))
            # Prese assemblies whose selected primary is a fuse holder or fuse-link
            # join Stage C by that primary; their evidence keeps the real hierarchy.
            elif group == 'Prese industriali' and m['code'] in SPECIAL:
                contexts.add((group, typology, 'C'))
            elif group in D_GROUPS or group == 'Dispositivi modulari':
                contexts.add((group, typology, 'D'))
        if not contexts:
            continue
        if len(contexts) != 1:
            raise ValueError(f'ambiguous source hierarchy {m["code"]}: {contexts}')
        group, typology, stage = contexts.pop()
        selected[m['id']] = (m, (group, typology), stage)
    missing = set(SPECIAL) - {m['code'] for m, _, _ in selected.values()}
    if missing:
        raise ValueError(f'Prese Stage C assemblies not found under Prese industriali: {sorted(missing)}')
    return selected


def category(group, typology, name, code):
    if code in SPECIAL: return SPECIAL[code]
    if group == 'Sezionatori con maniglia': return 'manovra.sezionatori'
    if group == 'Interruttori scatolati':
        if typology == 'Portafusibili SPX3': return 'manovra.sezionatori_fusibili'
        if typology == 'Relè differenziale per Avanquadro': return 'protezione.rele_differenziali'
        if 'Sezionator' in typology or name.startswith('Megabreak MS '):
            # Tipologia "Sezionatori differenziali" and names "Sezionatore Differenziale" /
            # "Sezionat. Diff." both mark residual switch-disconnectors; match case-insensitively.
            residual = 'differenzial' in typology.lower() or 'diff' in name.lower()
            return 'manovra.sezionatori_differenziali' if residual else 'manovra.sezionatori'
        if name.startswith(('Megabreak ', 'DMX3 ')): return 'protezione.interruttori_aperti'
        return ('protezione.interruttori_scatolati_differenziali'
                if ('differenziali' in typology.lower() or 'Diff.' in name or 'Diff ' in name)
                else 'protezione.interruttori_scatolati')
    if typology == 'Protezione' or typology == 'Portafusibili': return 'protezione.portafusibili'
    if typology == 'Salvamotori': return 'protezione.salvamotori'
    if typology == 'Limitatori di Sovratensione': return 'protezione.limitatori_sovratensione'
    if typology == 'Relè differenziale / Toroide': return 'protezione.rele_differenziali'
    if typology == 'Sezionatori': return 'manovra.sezionatori'
    if 'Stop Arc' in name: return 'protezione.rilevatori_arco'
    if typology == 'Differenziali puri': return 'protezione.differenziali_puri'
    if typology in ('Magnetotermici differenziali', 'Differenziali monoblocco'):
        return 'protezione.magnetotermici_differenziali'
    if typology in ('Magnetotermici', 'Solo Magnetici'):
        return 'protezione.interruttori_automatici'
    raise ValueError(f'unclassified {code} {group} {typology} {name}')


def category_d(group, typology, name, code, primaries):
    """Stage D category by the function of the selected primary; packages by their own."""
    functions = {ARTICLE_FUNCTION[p] for p in primaries if p in ARTICLE_FUNCTION}
    if functions:
        if len(functions) != 1 or any(p not in ARTICLE_FUNCTION for p in primaries):
            raise ValueError(f'mixed functional primaries {code}: {sorted(primaries)}')
        return functions.pop()
    if group == 'Dispositivi modulari':
        if typology == 'Relè' and name.startswith('Temporizz.'):
            return 'comando.interruttori_orari_temporizzatori'
        if typology == 'Prese/Contaore':
            return 'misura.strumenti_di_misura' if name == 'Contaore' else 'accessori.accessori_quadro'
        if typology in D_MODULAR: return D_MODULAR[typology]
    elif group == 'Contattori non modulari':
        # CTX3 + MPX assemblies select the MPX motor protector as their primary.
        return 'protezione.salvamotori' if name.endswith('+ MPX') else 'comando.contattori_rele'
    elif group in D_GROUP_CATEGORY:
        return D_GROUP_CATEGORY[group]
    raise ValueError(f'unclassified Stage D {code} {group} {typology} {name}')


def d_reason(dimension, label):
    if dimension == 'tq.label.180':
        # One TiQuadri label id names both the socket's protective MCB and a cable extension.
        return ASSEMBLY if label.startswith('Btdin') else ACCESSORY
    if dimension not in D_REASONS:
        raise ValueError(f'unreviewed Stage D option dimension {dimension} ({label})')
    return D_REASONS[dimension]


def trip_unit(name, descriptions):
    """Stage E. (type, evidence) where the pack name states the protective function, or
    names no function and every selected article's METEL text says magnetotermico."""
    if name.startswith(('Megabreak ', 'DMX3 ')): return None, None
    if re.search(r'\bLsig\b', name): return 'electronic_lsig', 'pack name'
    if re.search(r'\bLsi\b', name): return 'electronic_lsi', 'pack name'
    if re.search(r'\bLi\b', name): return 'electronic_li', 'pack name'
    if re.search(r'Solo\s+magnet|\bElettr\S*\s+SM\b', name, re.I): return 'magnetic_only', 'pack name'
    if re.search(r'Elettronic', name, re.I): return 'electronic', 'pack name'
    if re.search(r'\bMagnetot\.', name): return 'thermomagnetic', 'pack name "Magnetot."'
    # "Magnetotermici" Tipologie also hold electronic breakers, so they are not evidence;
    # abbreviations such as "magn+diff" are not either.
    if descriptions and all(THERMOMAGNETIC_TEXT.search(d or '') for d in descriptions):
        return 'thermomagnetic', 'METEL "magnetotermico" text of every selected article'
    return None, None


def model_attributes(name, cat, parser_icn):
    attrs = []
    def option(a, v): attrs.append({'attribute': a, 'option': v})
    def number(a, v): attrs.append({'attribute': a, 'number': v})
    # A pack name's single pole token describes the primary device. Physical
    # socket-assembly poles and SPD connection topology are deliberately skipped.
    if cat not in {'protezione.rele_differenziali', 'protezione.limitatori_sovratensione',
                   'protezione.fusibili', 'protezione.portafusibili'}:
        p = re.search(r'(?<!\d)([1-4])\s*P(?:\s*\+\s*N)?\b', name, re.I)
        if p:
            token = p.group(0).replace(' ', '').upper()
            poles = p.group(1) + ('p_n' if '+N' in token and p.group(1) in ('1','3') else 'p')
            option('poles', poles)
        else:
            p = re.search(r'(?<!\d)([1-4])\s+Pol[oi](?:\s*\+\s*(?:Neutro|N))?', name, re.I)
            if p:
                token = p.group(0).lower()
                poles = p.group(1) + ('p_n' if ('+' in token and p.group(1) in ('1','3')) else 'p')
                option('poles', poles)
    if cat in {'protezione.interruttori_scatolati',
               'protezione.interruttori_scatolati_differenziali', 'protezione.interruttori_aperti'}:
        # DMX3 labels state 800/1000 V capacities, not an AC 400/415 V Icu.
        if not name.startswith('DMX3 '):
            ka = re.findall(r'(?<![\d,])(\d{1,3}(?:,\d+)?)\s*kA\b', name, re.I)
            if len(set(ka)) == 1 and ka:
                number('rated_ultimate_breaking_capacity', float(ka[0].replace(',', '.')))
    if cat in {'protezione.interruttori_automatici', 'protezione.magnetotermici_differenziali',
               'protezione.rilevatori_arco'}:
        curve = re.search(r'Magnetot\.[^"“]{0,24}["“]([BCDKZ])["”]|Curva\s+["“]?([BCDKZ])\b', name, re.I)
        if curve: option('trip_curve', (curve.group(1) or curve.group(2)).lower())
        ka = re.findall(r'(?<![\d,])(\d{1,3}(?:,\d+)?)\s*kA\b', name, re.I)
        if len(set(ka)) == 1 and ka:
            number('declared_breaking_capacity', float(ka[0].replace(',', '.')))
        elif parser_icn is not None:
            number('declared_breaking_capacity', parser_icn)
    if cat in {'protezione.magnetotermici_differenziali', 'protezione.differenziali_puri',
               'protezione.rilevatori_arco'} and 'Reg.' not in name:
        ma = re.findall(r'(?<!\d)(\d{2,3})\s*mA\b', name, re.I)
        if len(set(ma)) == 1 and ma: number('rated_residual_current', int(ma[0]))
    if cat in {'protezione.magnetotermici_differenziali', 'protezione.differenziali_puri',
               'protezione.rilevatori_arco'}:
        typ = re.search(r'(?:Diff\.\s*|Tipo\s*)["“](AC|AS|A|F|B)["”]', name, re.I)
        if typ: option('residual_current_type', {'as':'a'}.get(typ.group(1).lower(),typ.group(1).lower()))
    return attrs


def not_applicable_reason(dimension):
    return {
        'tq.label.52': 'Selectable differential module or adjustable threshold; not fixed article-integrated Idn',
        'tq.label.210': 'Upstream SPD protection selection; not the SPD nominal current or breaking capacity',
        'tq.label.950': 'Motor-protection setting range; not nominal current In',
        'tq.label.170': 'Socket enclosure IP choice; not a primary electrical characteristic',
    }.get(dimension, 'Configuration/accessory choice; not an article-true Stage C electrical rating')


def generate(conn, existing):
    selected = catalogue(conn)
    already_seeded=conn.execute("select count(*) from cat_config_model where category_source='seed' and id in ("+
        ','.join('?'*len(selected))+')', [*selected]).fetchone()[0]
    if already_seeded:
        raise ValueError('generator requires a Stage B baseline catalogue before Stage C model-category sync')
    attr_ids = {r['code']: r['id'] for r in conn.execute('select id,code from cat_attribute')}
    icn_id = attr_ids['declared_breaking_capacity']
    models=[]; conflicts=[]; seen_entries=collections.defaultdict(set)
    trip_units=collections.Counter()
    for mid,(m,(group,typology),stage) in sorted(selected.items(), key=lambda x:x[1][0]['code']):
        code,name=m['code'],m['name']
        entries=list(conn.execute('select p.id,p.manufacturer_code,p.short_description,p.category_id,p.category_source,b.metel_marchio,s.code as family from cat_config_model_entry e join cat_product p on p.id=e.product_id join cat_brand b on b.id=p.brand_id left join cat_metel_family s on s.id=p.statistical_family_id where e.model_id=? order by p.manufacturer_code',(mid,)))
        if stage == 'D':
            cat=category_d(group,typology,name,code,{f"{p['metel_marchio']}:{p['manufacturer_code']}" for p in entries})
            for p in entries: seen_entries[p['id']].add(cat)
            # Stage D categories carry no reviewed model facts; Fusibili In comes from
            # the Stage B Taratura map through package offers (Stage F).
            evidence=f'TiQuadri ANA_PACK {code.split(".")[-1]}: {name}; LQ group {group}; Tipologia {typology}'
            if name.endswith('+ MPX'):
                evidence+='; assembly classified by its selected primary '+'; '.join(
                    f"{p['metel_marchio']}:{p['manufacturer_code']} \"{p['short_description']}\" ({p['family']})" for p in entries)
            models.append({'model':code,'reviewedName':name,'category':cat,'attributes':[],'evidence':evidence})
            continue
        cat=category(group,typology,name,code)
        # Assembly packs named Diff. can select an unchanged plain breaker and add
        # a separate differential module. Their contribution follows the primary.
        old_cats={r[0] for p in entries if p['category_source']=='mapping' for r in conn.execute('select code from cat_category where id=?',(p['category_id'],))}
        if group == 'Dispositivi modulari' and len(old_cats)==1:
            old_cat=next(iter(old_cats))
            if old_cat in {'protezione.interruttori_automatici','protezione.magnetotermici_differenziali',
                           'protezione.differenziali_puri','protezione.rilevatori_arco'}:
                cat=old_cat
        if cat == 'protezione.interruttori_scatolati_differenziali' and entries and all('diff' not in (p['short_description'] or '').lower() for p in entries):
            cat='protezione.interruttori_scatolati'
        if cat == 'manovra.sezionatori_differenziali' and entries and all('diff' not in (p['short_description'] or '').lower() for p in entries):
            cat='manovra.sezionatori'
        for p in entries: seen_entries[p['id']].add(cat)
        parser_vals={r['value_num'] for r in conn.execute('select pa.value_num from cat_config_model_entry e join cat_product_attribute pa on pa.product_id=e.product_id where e.model_id=? and pa.attribute_id=? and pa.source in (\'parser\',\'engineering\') and pa.value_num is not null',(mid,icn_id))}
        parser_icn=next(iter(parser_vals)) if len(parser_vals)==1 and entries and len(parser_vals)==len({r['value_num'] for r in conn.execute('select pa.value_num from cat_config_model_entry e left join cat_product_attribute pa on pa.product_id=e.product_id and pa.attribute_id=? where e.model_id=?',(icn_id,mid))}) else None
        attrs=model_attributes(name,cat,parser_icn)
        evidence=f'TiQuadri ANA_PACK {code.split(".")[-1]}: {name}; LQ group {group}; Tipologia {typology}'
        if parser_icn is not None and not re.search(r'\d\s*kA\b',name,re.I):
            evidence+=f'; METEL primary descriptions agree on declared Icn {parser_icn:g} kA'
        if cat in TRIP_UNIT_CATEGORIES:
            unit,source=trip_unit(name,[p['short_description'] for p in entries])
            trip_units[unit]+=1
            if unit:
                attrs.append({'attribute':'trip_unit_type','option':unit})
                evidence+=f'; trip unit {unit} from {source}'
        if code in SPECIAL:
            primaries='; '.join(f'{r[0]}:{r[1]} "{r[2]}"' for r in conn.execute('select b.metel_marchio,p.manufacturer_code,p.short_description from cat_config_model_entry e join cat_product p on p.id=e.product_id join cat_brand b on b.id=p.brand_id where e.model_id=? order by p.manufacturer_code',(mid,)))
            evidence+=f'; assembly classified by its selected primary {primaries}'
        models.append({'model':code,'reviewedName':name,'category':cat,'attributes':attrs,'evidence':evidence})
    for pid,cats in seen_entries.items():
        if len(cats)>1:
            p=conn.execute('select manufacturer_code from cat_product where id=?',(pid,)).fetchone()
            conflicts.append({'article':p[0], 'categories':sorted(cats)})
    # Explicit records for each active option value used by Apparecchi models. Stage C
    # values keep their reviewed reasons; the sole added technical option axis there is
    # Tipo differenziale. Values used only by Stage D models need a reviewed D reason.
    def used_by(stage):
        ids=[mid for mid,(_,_,s) in selected.items() if s==stage]
        return {(r['dim'],r['val']):r['label'] for r in conn.execute('select distinct d.code as dim,v.code as val,v.label from cat_config_option o join cat_config_axis a on a.id=o.axis_id join cat_config_dimension_value v on v.id=o.value_id join cat_config_dimension d on d.id=v.dimension_id where a.model_id in ('+','.join('?'*len(ids))+') and o.active=1 and v.active=1',ids)}
    used_c,used_d=used_by('C'),used_by('D')
    mapped={(v['dimension'],v['value']) for v in existing['values']}
    excluded={(v['dimension'],v['value']) for v in existing['notApplicable'] if 'dimension' in v}
    values=[]; not_app=[]
    for (dim,val),label in sorted(used_c.items()):
        if (dim,val) in mapped or (dim,val) in excluded: continue
        if dim=='tq.label.152' and label in TYPE_VALUES:
            values.append({'dimension':dim,'value':val,'reviewedLabel':label,
                           'attributes':[{'attribute':'residual_current_type','option':TYPE_VALUES[label]}]})
        else:
            not_app.append({'dimension':dim,'value':val,'reviewedLabel':label,
                            'reason':not_applicable_reason(dim)})
    covered=mapped|excluded|set(used_c)
    for (dim,val),label in sorted(used_d.items()):
        if (dim,val) in covered: continue
        not_app.append({'dimension':dim,'value':val,'reviewedLabel':label,'reason':d_reason(dim,label)})
    stages=collections.Counter(s for _,_,s in selected.values())
    return models,values,not_app,conflicts,len(seen_entries),len(used_c)+len(set(used_d)-set(used_c)),stages,trip_units


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('database',type=Path,help='already imported development lq.db')
    ap.add_argument('--seed',type=Path,default=Path('db/seed/engineering-vocabulary/tiquadri.json'))
    ap.add_argument('--output',type=Path,required=True,help='proposal path; never overwritten implicitly')
    args=ap.parse_args()
    if args.output.exists(): ap.error('output exists; remove it explicitly before regenerating')
    conn=sqlite3.connect(f'file:{args.database}?mode=ro',uri=True)
    existing=json.loads(args.seed.read_text())
    models,values,not_app,conflicts,articles,used,stages,trip_units=generate(conn,existing)
    proposal=dict(existing)
    proposal['models']=models
    proposal['values']=existing['values']+values
    proposal['notApplicable']=existing['notApplicable']+not_app
    args.output.write_text(json.dumps(proposal,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'models':len(models),'modelsByStage':dict(stages),
                      'tripUnitModels':{str(k):v for k,v in trip_units.items()},
                      'articles':articles,'newValues':len(values),
                      'newNotApplicable':len(not_app),'usedValues':used,
                      'categoryConflicts':conflicts[:50], 'conflictCount':len(conflicts)},ensure_ascii=False,indent=2))

if __name__=='__main__': main()
