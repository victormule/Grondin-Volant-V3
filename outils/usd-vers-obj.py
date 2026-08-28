# Extrait le maillage d'un fichier USD (.usdc, .usda, .usdz) vers un OBJ.
#
#   python outils/usd-vers-obj.py <entree.usdc> <sortie.obj>
#   python outils/usd-vers-obj.py <entree.usdc>            (inspection seule)
#
# POURQUOI CE DÉTOUR. dür.air exporte le maillage LiDAR — la reconstruction de
# scène d'ARKit — au format USD binaire, à l'intérieur d'un .usdz. Le reste de
# la chaîne d'ingestion lit de l'OBJ, et rien en JavaScript ne sait ouvrir du
# « PXR-USDC » : c'est un format à table de chaînes, à compression LZ4 et à
# index de champs, pas un conteneur qu'on décode en cent lignes. La
# bibliothèque de référence est en C++ avec un binding Python (« usd-core » sur
# PyPI), et c'est le seul chemin honnête.
#
# Ce que le script fait : parcourt la scène, prend chaque UsdGeom.Mesh, applique
# sa transformation vers le monde, triangule les faces (ARKit en produit déjà
# des triangles, mais l'USD autorise n'importe quel polygone) et écrit un OBJ.
# Les couleurs par sommet, si elles existent, partent en extension « v x y z r
# g b » — que MeshLab et Blender lisent, et que notre lecteur ignore sans se
# plaindre puisqu'il ne prend que les trois premiers nombres.

import sys
from pathlib import Path

from pxr import Usd, UsdGeom, Vt  # noqa: F401  (Vt sert au typage des tableaux)


def lire_maillages(chemin):
    """Rend la liste des maillages du fichier, déjà placés dans le monde."""
    scene = Usd.Stage.Open(str(chemin))
    if scene is None:
        raise SystemExit(f"USD illisible : {chemin}")

    maillages = []
    for prim in scene.Traverse():
        if not prim.IsA(UsdGeom.Mesh):
            continue
        maille = UsdGeom.Mesh(prim)
        points = maille.GetPointsAttr().Get()
        comptes = maille.GetFaceVertexCountsAttr().Get()
        indices = maille.GetFaceVertexIndicesAttr().Get()
        if not points or not comptes or not indices:
            continue

        # La position d'un maillage dans la scène tient dans sa hiérarchie de
        # transformations. L'ignorer donnerait des morceaux empilés à l'origine.
        vers_monde = UsdGeom.Xformable(prim).ComputeLocalToWorldTransform(Usd.TimeCode.Default())

        couleurs = None
        primvars = UsdGeom.PrimvarsAPI(prim)
        pv = primvars.GetPrimvar("displayColor")
        if pv and pv.HasValue():
            valeurs = pv.Get()
            # Une seule couleur pour tout le maillage n'apprend rien ; on ne
            # garde que les couleurs réellement par sommet.
            if valeurs is not None and len(valeurs) == len(points):
                couleurs = valeurs

        maillages.append({
            "chemin": str(prim.GetPath()),
            "points": [vers_monde.Transform(p) for p in points],
            "comptes": list(comptes),
            "indices": list(indices),
            "couleurs": couleurs,
        })
    return maillages


def trianguler(m):
    """Les faces du maillage, en triangles, indices à partir de zéro."""
    triangles = []
    curseur = 0
    for n in m["comptes"]:
        face = m["indices"][curseur:curseur + n]
        curseur += n
        # Éventail : correct pour un triangle (le cas d'ARKit) comme pour tout
        # polygone convexe.
        for k in range(1, n - 1):
            triangles.append((face[0], face[k], face[k + 1]))
    return triangles


def normales_par_sommet(points, triangles):
    """Somme des normales de faces, pondérée par leur aire (le produit
    vectoriel non normalisé la porte déjà), puis normalisée.

    ARKit ne livre pas de normales avec sa reconstruction de scène, et un
    maillage sans normales s'éclaire mal : three.js n'en calcule pas à la volée
    pour un matériau standard, et la surface sort plate et sourde. Les calculer
    ici évite d'avoir à le faire trois fois en aval.
    """
    acc = [[0.0, 0.0, 0.0] for _ in points]
    for a, b, c in triangles:
        pa, pb, pc = points[a], points[b], points[c]
        u = (pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2])
        v = (pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2])
        n = (u[1] * v[2] - u[2] * v[1],
             u[2] * v[0] - u[0] * v[2],
             u[0] * v[1] - u[1] * v[0])
        for i in (a, b, c):
            acc[i][0] += n[0]
            acc[i][1] += n[1]
            acc[i][2] += n[2]
    sortie = []
    for n in acc:
        longueur = (n[0] ** 2 + n[1] ** 2 + n[2] ** 2) ** 0.5
        sortie.append((n[0] / longueur, n[1] / longueur, n[2] / longueur)
                      if longueur > 1e-12 else (0.0, 1.0, 0.0))
    return sortie


def ecrire_obj(maillages, sortie):
    decalage = 1  # l'OBJ numérote les sommets à partir de 1
    with open(sortie, "w", encoding="utf-8") as f:
        f.write("# Maillage LiDAR extrait d'un USD par outils/usd-vers-obj.py\n")
        for m in maillages:
            f.write(f"o {m['chemin'].strip('/').replace('/', '_') or 'maillage'}\n")
            couleurs = m["couleurs"]
            for i, p in enumerate(m["points"]):
                if couleurs is not None:
                    c = couleurs[i]
                    f.write(f"v {p[0]:.6f} {p[1]:.6f} {p[2]:.6f} {c[0]:.4f} {c[1]:.4f} {c[2]:.4f}\n")
                else:
                    f.write(f"v {p[0]:.6f} {p[1]:.6f} {p[2]:.6f}\n")

            triangles = trianguler(m)
            for n in normales_par_sommet(m["points"], triangles):
                f.write(f"vn {n[0]:.5f} {n[1]:.5f} {n[2]:.5f}\n")
            for a, b, c in triangles:
                a += decalage
                b += decalage
                c += decalage
                f.write(f"f {a}//{a} {b}//{b} {c}//{c}\n")
            decalage += len(m["points"])


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Usage : python outils/usd-vers-obj.py <entree.usd*> [sortie.obj]")
    entree = Path(sys.argv[1])
    maillages = lire_maillages(entree)
    if not maillages:
        raise SystemExit("Aucun UsdGeom.Mesh dans ce fichier.")

    total_pts = sum(len(m["points"]) for m in maillages)
    total_tri = sum(sum(max(0, n - 2) for n in m["comptes"]) for m in maillages)
    print(f"{len(maillages)} maillage(s), {total_pts} sommets, {total_tri} triangles")
    for m in maillages:
        xs = [p[0] for p in m["points"]]
        ys = [p[1] for p in m["points"]]
        zs = [p[2] for p in m["points"]]
        couleur = "avec couleurs" if m["couleurs"] is not None else "sans couleur"
        print(f"  {m['chemin']}  {len(m['points'])} sommets, {couleur}")
        print(f"     x {min(xs):.2f}..{max(xs):.2f}   y {min(ys):.2f}..{max(ys):.2f}   "
              f"z {min(zs):.2f}..{max(zs):.2f}")

    if len(sys.argv) >= 3:
        sortie = Path(sys.argv[2])
        sortie.parent.mkdir(parents=True, exist_ok=True)
        ecrire_obj(maillages, sortie)
        print(f"\n{sortie} écrit ({sortie.stat().st_size / 1048576:.1f} Mo)")


if __name__ == "__main__":
    main()
