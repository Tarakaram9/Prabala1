"""Ensure Azure File Share volume/mount exists on the Container App template YAML.

Usage: python3 patch-volumes.py <input.yaml> <output.yaml>
"""
import sys
import yaml

with open(sys.argv[1]) as fh:
    app = yaml.safe_load(fh)

tmpl = app["properties"]["template"]

vols = tmpl.get("volumes") or []
if not any(v.get("name") == "prabala-workspaces" for v in vols):
    vols.append(
        dict(name="prabala-workspaces", storageType="AzureFile", storageName="prabala-workspaces")
    )
tmpl["volumes"] = vols

mnts = tmpl["containers"][0].get("volumeMounts") or []
if not any(m.get("mountPath") == "/workspaces" for m in mnts):
    mnts.append(dict(volumeName="prabala-workspaces", mountPath="/workspaces"))
tmpl["containers"][0]["volumeMounts"] = mnts

with open(sys.argv[2], "w") as fh:
    yaml.dump(app, fh, default_flow_style=False)
