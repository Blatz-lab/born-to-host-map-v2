const Anthropic = require('@anthropic-ai/sdk');

exports.handler = async (event) => {
    // CORS headers
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    // Handle preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        const { file, mimeType } = JSON.parse(event.body);

        if (!file || !mimeType) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Fichier ou type MIME manquant' })
            };
        }

        // Vérifier que la clé API est configurée
        if (!process.env.CLAUDE_API_KEY) {
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'Clé API Claude non configurée sur le serveur' })
            };
        }

        // Initialiser le client Anthropic
        const anthropic = new Anthropic({
            apiKey: process.env.CLAUDE_API_KEY,
        });

        // Extraire le base64 (enlever le préfixe data:xxx;base64,)
        const base64Data = file.includes(',') ? file.split(',')[1] : file;

        // Construire le bloc de contenu selon le type de fichier
        let contentBlock;

        if (mimeType === 'application/pdf') {
            // Pour les PDF : utiliser le type "document"
            contentBlock = {
                type: 'document',
                source: {
                    type: 'base64',
                    media_type: 'application/pdf',
                    data: base64Data,
                },
            };
        } else {
            // Pour les images (PNG, JPG) : utiliser le type "image"
            contentBlock = {
                type: 'image',
                source: {
                    type: 'base64',
                    media_type: mimeType,
                    data: base64Data,
                },
            };
        }

        // Appeler l'API Claude
        const message = await anthropic.messages.create({
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 1024,
            messages: [
                {
                    role: 'user',
                    content: [
                        contentBlock,
                        {
                            type: 'text',
                            text: `Analyse ce document (un devis de location d'appartements à Cannes) et extrais TOUTES les références d'appartements.

Les références suivent le format "Ref." suivi d'un code comme : A1B205, A1B226, A0B123, A1B47, etc.
Le pattern est : la lettre A, puis un chiffre (0-9), puis la lettre B, puis un nombre (1 à 3 chiffres).

Retourne UNIQUEMENT un objet JSON valide avec les références trouvées, sans aucun texte avant ou après, sans backticks markdown.
Format exact attendu : {"references": ["A1B205", "A1B226", "A0B123"]}`
                        }
                    ],
                },
            ],
        });

        // Extraire le texte de la réponse
        const responseText = message.content[0].text;
        console.log('Claude response:', responseText);

        // Parser la réponse JSON
        let parsedResponse;
        try {
            // Nettoyer la réponse (enlever les éventuels backticks markdown)
            const cleanedText = responseText
                .replace(/```json\s*/g, '')
                .replace(/```\s*/g, '')
                .trim();
            parsedResponse = JSON.parse(cleanedText);
        } catch (e) {
            // Si ça échoue, essayer d'extraire le JSON de la réponse
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                parsedResponse = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error('Impossible de parser la réponse de Claude : ' + responseText.substring(0, 200));
            }
        }

        const references = parsedResponse.references || [];

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                references: references,
                count: references.length,
                message: `${references.length} référence(s) extraite(s) avec succès`
            })
        };

    } catch (error) {
        console.error('Error:', error);

        // Messages d'erreur plus explicites
        let errorMessage = 'Erreur lors de l\'extraction';
        if (error.status === 401) {
            errorMessage = 'Clé API Claude invalide. Vérifiez la variable CLAUDE_API_KEY dans Netlify.';
        } else if (error.status === 429) {
            errorMessage = 'Trop de requêtes. Veuillez réessayer dans quelques secondes.';
        } else if (error.status === 400) {
            errorMessage = 'Fichier non valide ou trop volumineux. Max 32 MB pour les PDF, 100 pages.';
        } else if (error.message) {
            errorMessage = error.message;
        }

        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: errorMessage,
                details: error.toString()
            })
        };
    }
};