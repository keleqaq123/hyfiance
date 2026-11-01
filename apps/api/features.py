import json
from pathlib import Path
from network_config import network_config

def feature_enabled(name):
    if network_config()['chain_id'] != 99801:
        return True
    config=json.loads((Path(__file__).resolve().parents[2]/'networks'/'elysium-features.json').read_text(encoding='utf-8'))
    return bool(config.get(name,False))

def core_experience():
    return network_config()['chain_id']==99801 and not feature_enabled('syntheticMarkets')
