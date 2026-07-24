// Lanceur du site pointé sur le graphe de test de l'endgame du code.
// Fixe l'environnement AVANT d'importer server.js (qui lit PORT et
// FALKORDB_GRAPH à l'import), puis démarre le serveur normal.
// But : un process node direct, suivi de façon fiable par le gestionnaire
// de preview — sans wrapper `cmd /c set …&&` qui casse le suivi du PID.
process.env.PORT = process.env.PORT || "4599";
process.env.FALKORDB_GRAPH = process.env.FALKORDB_GRAPH || "code_endgame_test";

await import("../src/server.js");
