import React, { useState, useEffect } from "react";
import { HeaderUI, TypographyUI, Popup } from "../Scripts/ui/index";
import { useLocation } from "react-router-dom";
import iconStar from '/src/assets/Star.png'; 
import { addGameToFavorites, removeFromFavorites } from "../Scripts/api/watchListGameApi";
import { addReview, getAllReviews, deleteReview } from "../Scripts/api/reviewApi";
import { getAllUsers } from "../Scripts/api/userApi";

const StarRating = ({ rating, interactive = false, setRating = null }) => {
    return (
        <div className="flex cursor-pointer">
            {[1, 2, 3, 4, 5].map((star) => (
                <span 
                    key={star} 
                    onClick={() => interactive && setRating && setRating(star)}
                    className={`text-xl transition-colors ${interactive ? "hover:scale-110" : ""} ${star <= rating ? "text-yellow-400" : "text-gray-600"}`}
                >
                    ★
                </span>
            ))}
        </div>
    );
};

export function AboutGame() {
    const { state } = useLocation();

    const formatGameData = (data) => {
        if (!data) return null;
        const g = data.jogo || data.infosGame || data;

        const fixImg = (url) => {
            if (!url) return "";
            let clean = typeof url === 'string' ? url : url.url;
            if (clean?.startsWith("//")) clean = `https:${clean}`;
            return clean?.replace("t_thumb", "t_cover_big").replace("t_screenshot_med", "t_screenshot_big");
        };

        const resolveCompany = (roleStr, roleObjKey) => {
            if (typeof g[roleStr] === 'string') return g[roleStr];
            if (typeof g[roleObjKey] === 'string') return g[roleObjKey];
            if (g[roleObjKey]?.nome) return g[roleObjKey].nome;
            if (g[`${roleObjKey}_obj`]?.nome) return g[`${roleObjKey}_obj`].nome;
            if (Array.isArray(g.involved_companies)) {
                const role = roleStr === 'developer' ? 'developer' : 'publisher';
                const found = g.involved_companies.find(c => c[role] || c.company?.name);
                return found?.company?.name || found?.name || null;
            }
            return "Desconhecido";
        };

        const rawSystem = g.media_nota ?? g.media_nota_sistema ?? g.media_geral ?? g.media ?? g.rating ?? 0;
        const rawMeta = g.metacritic_rating ?? g.nota_metacritic ?? g.metacritic ?? null;

        return {
            id: g.id_jogo || g.id,
            name: g.titulo || g.name,
            summary: g.descricao || g.summary || "Sem descrição disponível.",
            systemRating: Number(rawSystem) > 0 ? Number(rawSystem).toFixed(1) : "N/A",
            metacritic: rawMeta ? Math.round(rawMeta) : null,
            developer: resolveCompany("developer", "desenvolvedora"),
            publisher: resolveCompany("publisher", "publicadora"),
            cover_url: fixImg(g.cover_url || g.cover || g.capa_url),
            screenshots: (g.screenshots || []).map(s => fixImg(s)),
            genres: (g.generos || g.genres || []).map(gen => 
                typeof gen === 'string' ? gen : (gen.nome_genero || gen.name || gen)
            ),
            user_status: g.status_jogo || g.status || g.user_status || null,
            is_favorite: g.is_favorite || false,
        };
    };

    const [gameDetails, setGameDetails] = useState(null);
    const [isFavorite, setIsFavorite] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isPopUpOpen, setIsPopUpOpen] = useState(false);
    const [selectedImage, setSelectedImage] = useState(null);

    const [reviews, setReviews] = useState([]);
    const [reviewForm, setReviewForm] = useState({ nota: 5, comentario: "" });
    const [currentUser, setCurrentUser] = useState(null);
    const [usersMap, setUsersMap] = useState({});
    const [isLoadingReviews, setIsLoadingReviews] = useState(false);

    useEffect(() => {
        const storedUser = localStorage.getItem("@LetterPlay:user");
        if (storedUser) { try { setCurrentUser(JSON.parse(storedUser)); } catch (e) {} }

        const fetchUsers = async () => {
            try {
                const response = await getAllUsers();
                const list = response.items || response || [];
                if (Array.isArray(list)) {
                    const map = {};
                    list.forEach(u => { if(u.id && u.username) map[u.id] = u.username; });
                    setUsersMap(map);
                }
            } catch (e) { console.error("Erro users map", e); }
        };
        fetchUsers();
    }, []);

    useEffect(() => {
        const loadData = () => {
            let finalData = null;
            if (state?.infosGame) {
                finalData = formatGameData(state.infosGame);
                localStorage.setItem("currentGameCache", JSON.stringify(finalData));
            } else {
                const cached = localStorage.getItem("currentGameCache");
                if (cached) finalData = JSON.parse(cached);
            }

            if (finalData) {
                setGameDetails(finalData);
                setIsFavorite(finalData.is_favorite);
                loadReviews(finalData.id);
            }
            setIsLoading(false);
        };
        loadData();
    }, []);


    const loadReviews = async (gameId) => {
        try {
            setIsLoadingReviews(true);

            const data = await getAllReviews(gameId);
            
            setReviews(data.items || []);


            if (data.media_nota !== undefined && data.media_nota !== null) {
                setGameDetails(prevDetails => {
                    if (!prevDetails) return null;
                    return {
                        ...prevDetails,
                        systemRating: Number(data.media_nota).toFixed(1) 
                    };
                });
            }
    
        } catch (error) { 
            console.error("Erro reviews", error); 
        } finally { 
            setIsLoadingReviews(false); 
        }
    };

    const handlePostReview = async (e) => {
        e.preventDefault();
        if (!reviewForm.comentario.trim()) return alert("Escreva um comentário.");
        try {
            await addReview(gameDetails.id, reviewForm.nota, reviewForm.comentario);
            setReviewForm({ nota: 5, comentario: "" });
            

            await loadReviews(gameDetails.id); 
            
        } catch (error) { alert("voce nao pode avaliar um jogo que nao esta na sua lista."); }
    };

    const handleDeleteReview = async (reviewId) => {
        if (!window.confirm("Apagar avaliação?")) return;
        try { 
            await deleteReview(gameDetails.id, reviewId); 

            await loadReviews(gameDetails.id); 
        } catch (error) { alert("Erro ao apagar."); }
    };

    const toggleFavorite = async () => {
        if (!gameDetails?.id) return;
        const previous = isFavorite;
        setIsFavorite(!previous);
        try {
            if (previous) await removeFromFavorites(gameDetails.id);
            else await addGameToFavorites(gameDetails.id);
        } catch (error) { 
            setIsFavorite(previous); 
            alert("voce ja adicionou esse jogo aos favoritos"); 
        }
    };

    const abrirPopup = (img) => { setSelectedImage(img); setIsPopUpOpen(true); };
    const fecharPopup = () => setIsPopUpOpen(false);

    if (isLoading) return <div className="text-white p-20 text-center">Carregando...</div>;
    if (!gameDetails) return <div className="text-white text-center mt-20">Dados não encontrados.</div>;

    return (
        <div className="w-auto h-auto relative bg-background min-h-screen pb-20">
            <HeaderUI />

            <div className="absolute top-0 left-0 w-full h-[500px] z-0 overflow-hidden opacity-40">
                <div className="w-full h-full bg-cover bg-center blur-sm" style={{ backgroundImage: `url(${gameDetails.cover_url})`, maskImage: "linear-gradient(to bottom, black 0%, transparent 100%)" }}></div>
            </div>

            <div className="flex justify-center gap-24 px-10 relative z-10 pt-28">
                <div className="flex flex-col gap-6 w-96">
                    <div className="bg-cover bg-center h-[500px] w-full rounded-xl shadow-2xl border border-gray-800" style={{ backgroundImage: `url(${gameDetails.cover_url})` }}></div>
                    <div className="grid grid-cols-4 gap-2">
                        {gameDetails.screenshots?.slice(0, 4).map((shot, i) => (
                            <img key={i} src={shot} className="w-full h-16 rounded-lg object-cover cursor-pointer hover:opacity-80 border border-gray-700" onClick={() => abrirPopup(shot)} />
                        ))}
                    </div>
                    <div className="bg-black/30 p-6 rounded-xl grid gap-3 backdrop-blur-sm border border-white/10">
                        <div className="flex flex-col">
                            <span className="text-gray-400 text-sm font-bold uppercase">Desenvolvedora</span>
                            <span className="text-white font-medium text-lg">{gameDetails.developer}</span>
                        </div>
                        <div className="flex flex-col">
                            <span className="text-gray-400 text-sm font-bold uppercase">Publicadora</span>
                            <span className="text-white font-medium text-lg">{gameDetails.publisher}</span>
                        </div>
                    </div>
                </div>

                <div className="flex flex-col w-[600px] mt-10">
                    <TypographyUI as="h1" variant="titulo" className="text-6xl leading-tight mb-2">
                        {gameDetails.name}
                    </TypographyUI>

                    {gameDetails.user_status && gameDetails.user_status !== "AINDA NAO JOGADO" && (
                        <div className={`mb-4 px-3 py-1 rounded text-xs font-bold w-fit border uppercase ${gameDetails.user_status === 'JOGADO' ? 'bg-green-900/30 text-green-400 border-green-500/30' : 'bg-red-900/30 text-red-400 border-red-500/30'}`}>
                            {gameDetails.user_status}
                        </div>
                    )}

                    <TypographyUI as="span" variant="muted" className="text-xl mb-8 block">
                        {gameDetails.genres.join(", ")}
                    </TypographyUI>

                    <div className="bg-black/20 p-6 rounded-xl border border-white/5 mb-8">
                        <TypographyUI as="p" variant="default" className="text-lg leading-relaxed text-gray-200">
                            {gameDetails.summary}
                        </TypographyUI>
                    </div>

                    <div className="flex flex-wrap items-center gap-8 mb-12">
                        
                        <div className="flex flex-col items-center group">
                            <span className="text-gray-400 text-[10px] uppercase mb-1 font-bold tracking-widest">Média Sistema</span>
                            <div className="flex items-center gap-3 bg-primary/20 px-5 py-3 rounded-xl border border-primary/50 shadow-lg shadow-primary/10 transition-all duration-300 transform group-hover:scale-105">
                                <img src={iconStar} className="h-8 w-8 drop-shadow-md" alt="Star" />
                                <span className="text-3xl font-bold text-white tracking-tight">
                                    {gameDetails.systemRating}
                                </span>
                            </div>
                        </div>

                        {gameDetails.metacritic !== null && (
                            <div className="flex flex-col items-center">
                                <span className="text-gray-400 text-[10px] uppercase mb-1 font-bold tracking-widest">Metacritic</span>
                                <div className={`w-16 h-[58px] flex items-center justify-center rounded-xl text-white text-2xl font-bold border-2 border-white/10 shadow-lg
                                    ${gameDetails.metacritic >= 75 ? "bg-[#6c3] shadow-green-500/20" : gameDetails.metacritic >= 50 ? "bg-[#fc3] shadow-yellow-500/20" : "bg-[#f00] shadow-red-500/20"}
                                `}>
                                    {gameDetails.metacritic}
                                </div>
                            </div>
                        )}

                        <button onClick={toggleFavorite} className={`mt-4 ml-auto group flex items-center gap-3 px-8 py-4 rounded-full transition-all border shadow-xl ${isFavorite ? "bg-primary/20 border-primary text-primary" : "bg-white/5 border-white/10 text-gray-400 hover:bg-white/10 hover:text-white"}`}>
                            <svg className={`h-6 w-6 ${isFavorite ? "fill-current" : "fill-none stroke-current"}`} viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
                            <span className="font-bold text-lg">{isFavorite ? "Favorito" : "Favoritar"}</span>
                        </button>
                    </div>
                </div>
            </div>

            <div className="max-w-5xl mx-auto px-10 border-t border-white/10 pt-10 mt-10">
                <TypographyUI as="h2" variant="titulo" className="text-3xl mb-8 text-white">Avaliações da Comunidade</TypographyUI>
                
                <div className="bg-black/30 p-6 rounded-xl border border-white/10 mb-10 backdrop-blur-md">
                    <h3 className="text-white text-xl font-semibold mb-4">Deixe sua avaliação</h3>
                    <form onSubmit={handlePostReview} className="flex flex-col gap-4">
                        <div className="flex items-center gap-3">
                            <span className="text-gray-300">Nota:</span>
                            <StarRating rating={reviewForm.nota} interactive={true} setRating={(n) => setReviewForm({...reviewForm, nota: n})} />
                            <span className="text-white font-bold ml-2">{reviewForm.nota}/5</span>
                        </div>
                        <textarea className="w-full bg-black/40 text-white rounded-lg p-3 border border-gray-700" placeholder="O que achou do jogo?" value={reviewForm.comentario} onChange={(e) => setReviewForm({ ...reviewForm, comentario: e.target.value })} />
                        <button type="submit" className="self-end bg-primary hover:bg-primary/80 text-white px-6 py-2 rounded-lg font-bold">Publicar</button>
                    </form>
                </div>

                <div className="flex flex-col gap-4">
                    {reviews.length === 0 ? <p className="text-gray-500">Nenhuma avaliação ainda.</p> : reviews.map((review) => (
                        <div key={review.id_avaliacao} className="bg-white/5 p-5 rounded-lg border border-white/5 flex justify-between">
                            <div>
                                <div className="flex items-center gap-3 mb-2">
                                    <StarRating rating={review.nota} />
                                    <span className="text-primary font-bold">{usersMap[review.id_user] || "Usuário"}</span>
                                </div>
                                <p className="text-gray-200">{review.comentario}</p>
                            </div>
                            {currentUser && currentUser.id === review.id_user && (
                                <button onClick={() => handleDeleteReview(review.id_avaliacao)} className="text-red-500 text-sm hover:underline">Excluir</button>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            <Popup isOpen={isPopUpOpen} onPopUpClick={fecharPopup} className="bg-black/90 flex items-center justify-center">
                <div className="relative">
                    <button onClick={fecharPopup} className="absolute -top-10 right-0 text-white text-xl">✕</button>
                    {selectedImage && <img src={selectedImage} className="max-h-[85vh] rounded-lg shadow-2xl" />}
                </div>
            </Popup>
        </div>
    );
}